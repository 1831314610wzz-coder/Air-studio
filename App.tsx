





import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Toolbar } from './components/Toolbar';
import { PromptBar } from './components/PromptBar';
import { Loader } from './components/Loader';
import { CanvasSettings } from './components/CanvasSettings';
import { OnboardingWizard } from './components/OnboardingWizard';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import type { Tool, Point, Element, ImageElement, PathElement, ShapeElement, TextElement, ArrowElement, UserEffect, LineElement, WheelAction, GroupElement, Board, VideoElement, AssetLibrary, AssetCategory, AssetItem, UserApiKey, ModelPreference, AIProvider, AICapability, PromptEnhanceMode, CharacterLockProfile, GenerationHistoryItem, ThemeMode, ChatAttachment } from './types';
import { AssetLibraryPanel } from './components/AssetLibraryPanel';
import { InspirationPanel } from './components/InspirationPanel';
import { RightPanel } from './components/RightPanel';
import { AssetAddModal } from './components/AssetAddModal';
import { loadAssetLibrary, addAsset, removeAsset, renameAsset } from './utils/assetStorage';
import { loadGenerationHistory, addGenerationHistoryItem } from './utils/generationHistory';
import { editImage, generateImageFromText, generateVideo, setGeminiRuntimeConfig, enhancePromptWithGemini } from './services/geminiService';
import { splitImageByBanana, runBananaImageAgent, setBananaRuntimeConfig } from './services/bananaService';
import { enhancePromptWithAgentPipeline, enhancePromptWithProvider, generateImageWithProvider, inferProviderFromModel } from './services/aiGateway';
import { fileToDataUrl } from './utils/fileUtils';
import { translations } from './translations';
import { useAPIConfigStore } from './src/store/api-config-store';
import { saveKeysEncrypted, loadKeysDecrypted, clearAllKeyData, migrateLegacyKeys } from './utils/keyVault';
import type { APIConfig } from './src/types/api-config';
import { getCompactChromeMetrics } from './utils/uiScale';

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getElementBounds = (element: Element, allElements: Element[] = []): { x: number; y: number; width: number; height: number } => {
    if (element.type === 'group') {
        const children = allElements.filter(el => el.parentId === element.id);
        if (children.length === 0) {
            return { x: element.x, y: element.y, width: element.width, height: element.height };
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        children.forEach(child => {
            const bounds = getElementBounds(child, allElements);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    if (element.type === 'image' || element.type === 'shape' || element.type === 'text' || element.type === 'video') {
        return { x: element.x, y: element.y, width: element.width, height: element.height };
    }
    if (element.type === 'arrow' || element.type === 'line') {
        const { points } = element;
        const minX = Math.min(points[0].x, points[1].x);
        const maxX = Math.max(points[0].x, points[1].x);
        const minY = Math.min(points[0].y, points[1].y);
        const maxY = Math.max(points[0].y, points[1].y);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    const { points } = element;
    if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = points[0].x, maxX = points[0].x;
    let minY = points[0].y, maxY = points[0].y;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

type Rect = { x: number; y: number; width: number; height: number };
type Guide = { type: 'v' | 'h'; position: number; start: number; end: number };
const SNAP_THRESHOLD = 5; // pixels in screen space

// Ray-casting algorithm to check if a point is inside a polygon
const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
    }
    return isInside;
};

const rasterizeElement = (element: Exclude<Element, ImageElement | VideoElement>): Promise<{ href: string; mimeType: 'image/png' }> => {
    return new Promise((resolve, reject) => {
        const bounds = getElementBounds(element);
        if (bounds.width <= 0 || bounds.height <= 0) {
            return reject(new Error('Cannot rasterize an element with zero or negative dimensions.'));
        }

        const padding = 10;
        const svgWidth = bounds.width + padding * 2;
        const svgHeight = bounds.height + padding * 2;
        
        const offsetX = -bounds.x + padding;
        const offsetY = -bounds.y + padding;

        let elementSvgString = '';
        
        switch (element.type) {
            case 'path': {
                const pointsWithOffset = element.points.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }));
                const pathData = pointsWithOffset.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                elementSvgString = `<path d="${pathData}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${element.strokeOpacity || 1}" />`;
                break;
            }
            case 'shape': {
                const shapeProps = `transform="translate(${element.x + offsetX}, ${element.y + offsetY})" fill="${element.fillColor}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}"`;
                if (element.shapeType === 'rectangle') elementSvgString = `<rect width="${element.width}" height="${element.height}" rx="${element.borderRadius || 0}" ry="${element.borderRadius || 0}" ${shapeProps} />`;
                else if (element.shapeType === 'circle') elementSvgString = `<ellipse cx="${element.width/2}" cy="${element.height/2}" rx="${element.width/2}" ry="${element.height/2}" ${shapeProps} />`;
                else if (element.shapeType === 'triangle') elementSvgString = `<polygon points="${element.width/2},0 0,${element.height} ${element.width},${element.height}" ${shapeProps} />`;
                break;
            }
            case 'arrow': {
                 const [start, end] = element.points;
                 const angle = Math.atan2(end.y - start.y, end.x - start.x);
                 const headLength = element.strokeWidth * 4;

                 const arrowHeadHeight = headLength * Math.cos(Math.PI / 6);
                 const lineEnd = {
                     x: end.x - arrowHeadHeight * Math.cos(angle),
                     y: end.y - arrowHeadHeight * Math.sin(angle),
                 };

                 const headPoint1 = { x: end.x - headLength * Math.cos(angle - Math.PI / 6), y: end.y - headLength * Math.sin(angle - Math.PI / 6) };
                 const headPoint2 = { x: end.x - headLength * Math.cos(angle + Math.PI / 6), y: end.y - headLength * Math.sin(angle + Math.PI / 6) };
                 elementSvgString = `
                    <line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${lineEnd.x + offsetX}" y2="${lineEnd.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />
                    <polygon points="${end.x + offsetX},${end.y + offsetY} ${headPoint1.x + offsetX},${headPoint1.y + offsetY} ${headPoint2.x + offsetX},${headPoint2.y + offsetY}" fill="${element.strokeColor}" />
                 `;
                break;
            }
            case 'line': {
                 const [start, end] = element.points;
                 elementSvgString = `<line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${end.x + offsetX}" y2="${end.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />`;
                break;
            }
            case 'text': {
                 elementSvgString = `
                    <foreignObject x="${offsetX}" y="${offsetY}" width="${element.width}" height="${element.height}">
                        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${element.fontSize}px; color: ${element.fontColor}; width: 100%; height: 100%; word-break: break-word; font-family: sans-serif; padding:0; margin:0; line-height: 1.2;">
                            ${element.text.replace(/\n/g, '<br />')}
                        </div>
                    </foreignObject>
                 `;
                 // Note: Text is rasterized from its top-left corner (x,y), not the bounds' corner
                 elementSvgString = elementSvgString.replace(`x="${offsetX}"`, `x="${element.x + offsetX}"`).replace(`y="${offsetY}"`, `y="${element.y + offsetY}"`);
                break;
            }
            case 'group': {
                elementSvgString = '';
                break;
            }
        }

        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">${elementSvgString}</svg>`;
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fullSvg)))}`;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = svgWidth;
            canvas.height = svgHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                resolve({ href: canvas.toDataURL('image/png'), mimeType: 'image/png' });
            } else {
                reject(new Error('Could not get canvas context.'));
            }
        };
        img.onerror = (err) => {
            reject(new Error(`Failed to load SVG into image: ${err}`));
        };
        img.src = svgDataUrl;
    });
};

const rasterizeElements = (elementsToRasterize: Exclude<Element, ImageElement | VideoElement>[]): Promise<{ href: string; mimeType: 'image/png', width: number, height: number }> => {
    return new Promise((resolve, reject) => {
        if (elementsToRasterize.length === 0) {
            return reject(new Error("No elements to rasterize."));
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elementsToRasterize.forEach(element => {
            const bounds = getElementBounds(element);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        const combinedWidth = maxX - minX;
        const combinedHeight = maxY - minY;

        if (combinedWidth <= 0 || combinedHeight <= 0) {
            return reject(new Error('Cannot rasterize elements with zero or negative dimensions.'));
        }

        const padding = 10;
        const svgWidth = combinedWidth + padding * 2;
        const svgHeight = combinedHeight + padding * 2;
        
        const elementSvgStrings = elementsToRasterize.map(element => {
            const offsetX = -minX + padding;
            const offsetY = -minY + padding;

            let elementSvgString = '';
            switch (element.type) {
                 case 'path': {
                    const pointsWithOffset = element.points.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }));
                    const pathData = pointsWithOffset.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                    elementSvgString = `<path d="${pathData}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${element.strokeOpacity || 1}" />`;
                    break;
                 }
                case 'shape': {
                    const shapeProps = `transform="translate(${element.x + offsetX}, ${element.y + offsetY})" fill="${element.fillColor}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}"`;
                    if (element.shapeType === 'rectangle') elementSvgString = `<rect width="${element.width}" height="${element.height}" rx="${element.borderRadius || 0}" ry="${element.borderRadius || 0}" ${shapeProps} />`;
                    else if (element.shapeType === 'circle') elementSvgString = `<ellipse cx="${element.width/2}" cy="${element.height/2}" rx="${element.width/2}" ry="${element.height/2}" ${shapeProps} />`;
                    else if (element.shapeType === 'triangle') elementSvgString = `<polygon points="${element.width/2},0 0,${element.height} ${element.width},${element.height}" ${shapeProps} />`;
                    break;
                }
                case 'arrow': {
                     const [start, end] = element.points;
                     const angle = Math.atan2(end.y - start.y, end.x - start.x);
                     const headLength = element.strokeWidth * 4;

                     const arrowHeadHeight = headLength * Math.cos(Math.PI / 6);
                     const lineEnd = {
                        x: end.x - arrowHeadHeight * Math.cos(angle),
                        y: end.y - arrowHeadHeight * Math.sin(angle),
                     };

                     const headPoint1 = { x: end.x - headLength * Math.cos(angle - Math.PI / 6), y: end.y - headLength * Math.sin(angle - Math.PI / 6) };
                     const headPoint2 = { x: end.x - headLength * Math.cos(angle + Math.PI / 6), y: end.y - headLength * Math.sin(angle + Math.PI / 6) };
                     elementSvgString = `
                        <line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${lineEnd.x + offsetX}" y2="${lineEnd.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />
                        <polygon points="${end.x + offsetX},${end.y + offsetY} ${headPoint1.x + offsetX},${headPoint1.y + offsetY} ${headPoint2.x + offsetX},${headPoint2.y + offsetY}" fill="${element.strokeColor}" />
                     `;
                    break;
                }
                 case 'line': {
                     const [start, end] = element.points;
                     elementSvgString = `<line x1="${start.x + offsetX}" y1="${start.y + offsetY}" x2="${end.x + offsetX}" y2="${end.y + offsetY}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" />`;
                    break;
                 }
                case 'text': {
                     elementSvgString = `
                        <foreignObject x="${element.x + offsetX}" y="${element.y + offsetY}" width="${element.width}" height="${element.height}">
                            <div xmlns="http://www.w3.org/1999/xhtml" style="font-size: ${element.fontSize}px; color: ${element.fontColor}; width: 100%; height: 100%; word-break: break-word; font-family: sans-serif; padding:0; margin:0; line-height: 1.2;">
                                ${element.text.replace(/\n/g, '<br />')}
                            </div>
                        </foreignObject>
                     `;
                    break;
                }
                case 'group': {
                    elementSvgString = '';
                    break;
                }
            }
            return elementSvgString;
        }).join('');

        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">${elementSvgStrings}</svg>`;
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fullSvg)))}`;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = svgWidth;
            canvas.height = svgHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                resolve({ 
                    href: canvas.toDataURL('image/png'), 
                    mimeType: 'image/png',
                    width: svgWidth,
                    height: svgHeight
                });
            } else {
                reject(new Error('Could not get canvas context.'));
            }
        };
        img.onerror = (err) => {
            reject(new Error(`Failed to load SVG into image: ${err}`));
        };
        img.src = svgDataUrl;
    });
};

const rasterizeMask = (
    maskPaths: PathElement[],
    baseImage: ImageElement
): Promise<{ href: string; mimeType: 'image/png' }> => {
    return new Promise((resolve, reject) => {
        const { width, height, x: imageX, y: imageY } = baseImage;
        if (width <= 0 || height <= 0) {
            return reject(new Error('Base image has invalid dimensions.'));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return reject(new Error('Could not get canvas context for mask.'));
        }

        // Black background for areas to be kept
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);

        // White for areas to be inpainted
        ctx.strokeStyle = 'white';
        ctx.fillStyle = 'white';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        maskPaths.forEach(path => {
            ctx.lineWidth = path.strokeWidth;
            ctx.beginPath();
            
            if (path.points.length === 1) {
                const point = path.points[0];
                ctx.arc(point.x - imageX, point.y - imageY, path.strokeWidth / 2, 0, 2 * Math.PI);
                ctx.fill();
            } else if (path.points.length > 1) {
                const startPoint = path.points[0];
                ctx.moveTo(startPoint.x - imageX, startPoint.y - imageY);
                for (let i = 1; i < path.points.length; i++) {
                    const point = path.points[i];
                    ctx.lineTo(point.x - imageX, point.y - imageY);
                }
                ctx.stroke();
            }
        });

        resolve({ href: canvas.toDataURL('image/png'), mimeType: 'image/png' });
    });
};

const createNewBoard = (name: string): Board => {
    const id = generateId();
    return {
        id,
        name,
        elements: [],
        history: [[]],
        historyIndex: 0,
        panOffset: { x: 0, y: 0 },
        zoom: 1,
        canvasBackgroundColor: '#FFFFFF',
    };
};

const parseEnvList = (raw?: string): string[] =>
    (raw || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

const ENV_CUSTOM_API_KEY = (import.meta.env.VITE_CUSTOM_API_KEY || '').trim();
const ENV_CUSTOM_API_BASE_URL = (import.meta.env.VITE_CUSTOM_API_BASE_URL || '').trim();
const ENV_CUSTOM_API_NAME = (import.meta.env.VITE_CUSTOM_API_NAME || 'apiyi').trim();
const ENV_CUSTOM_TEXT_API_KEY = (import.meta.env.VITE_CUSTOM_TEXT_API_KEY || '').trim();
const ENV_CUSTOM_TEXT_API_BASE_URL = (import.meta.env.VITE_CUSTOM_TEXT_API_BASE_URL || '').trim();
const ENV_CUSTOM_TEXT_API_NAME = (import.meta.env.VITE_CUSTOM_TEXT_API_NAME || 'ark-llm').trim();
const ENV_CUSTOM_IMAGE_API_KEY = (import.meta.env.VITE_CUSTOM_IMAGE_API_KEY || ENV_CUSTOM_API_KEY).trim();
const ENV_CUSTOM_IMAGE_API_BASE_URL = (import.meta.env.VITE_CUSTOM_IMAGE_API_BASE_URL || ENV_CUSTOM_API_BASE_URL).trim();
const ENV_CUSTOM_IMAGE_API_NAME = (import.meta.env.VITE_CUSTOM_IMAGE_API_NAME || ENV_CUSTOM_API_NAME).trim();
const ENV_CUSTOM_TEXT_MODELS = parseEnvList(import.meta.env.VITE_CUSTOM_TEXT_MODELS || 'gpt-5-nano,gpt-4.1-nano');
const ENV_CUSTOM_IMAGE_MODELS = parseEnvList(import.meta.env.VITE_CUSTOM_IMAGE_MODELS || 'nano-banana,nano-banana-2,nano-banana-pro');
const ENV_CUSTOM_DEFAULT_TEXT_MODEL = (import.meta.env.VITE_CUSTOM_DEFAULT_TEXT_MODEL || ENV_CUSTOM_TEXT_MODELS[0] || '').trim();
const ENV_CUSTOM_DEFAULT_IMAGE_MODEL = (import.meta.env.VITE_CUSTOM_DEFAULT_IMAGE_MODEL || ENV_CUSTOM_IMAGE_MODELS[0] || '').trim();
const ENV_CUSTOM_TEXT_KEY_ID = 'env_custom_text_api_key';
const ENV_CUSTOM_IMAGE_KEY_ID = 'env_custom_image_api_key';

const DEFAULT_MODEL_PREFS: ModelPreference = {
    textModel: ENV_CUSTOM_DEFAULT_TEXT_MODEL || 'gemini-2.5-pro',
    imageModel: ENV_CUSTOM_DEFAULT_IMAGE_MODEL || 'gemini-2.5-flash-image',
    videoModel: 'veo-2.0-generate-001',
    agentModel: 'banana-vision-v1',
};

// 鏍规嵁 provider 鏄犲皠鍑哄彲閫夋ā鍨嬪垪琛?
const PROVIDER_MODELS: Record<string, { text: string[]; image: string[]; video: string[] }> = {
    google:    { text: ['gemini-2.5-pro', 'gemini-2.5-flash'], image: ['gemini-2.5-flash-image', 'imagen-4.0-generate-001'], video: ['veo-2.0-generate-001'] },
    openai:    { text: ['gpt-4o-mini'], image: ['dall-e-3'], video: [] },
    anthropic: { text: ['claude-3-5-sonnet'], image: [], video: [] },
    qwen:      { text: ['qwen-max'], image: [], video: [] },
    stability: { text: [], image: ['sdxl'], video: [] },
    banana:    { text: [], image: [], video: [] },
    custom:    { text: ENV_CUSTOM_TEXT_MODELS, image: ENV_CUSTOM_IMAGE_MODELS, video: [] },
};
// 鍏滃簳锛氬綋鐢ㄦ埛娌℃湁浠讳綍 API Key 鏃剁殑榛樿閫夐」锛堜笉鍙敤锛屼粎鍗犱綅锛?
const FALLBACK_TEXT_OPTIONS = ['gemini-2.5-pro'];
const FALLBACK_IMAGE_OPTIONS = ['gemini-2.5-flash-image'];
const FALLBACK_VIDEO_OPTIONS = ['veo-2.0-generate-001'];
const IMAGE_RESOLUTION_OPTIONS = ['512x512', '768x768', '1024x1024', '1536x1536'] as const;
const IMAGE_ASPECT_RATIO_OPTIONS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
const BOARDS_STORAGE_KEY = 'boards.v1';
const ACTIVE_BOARD_STORAGE_KEY = 'boards.activeId.v1';
const MAX_PERSIST_BOARD_COUNT = 6;
const MAX_PERSIST_BOARD_HISTORY = 4;

const safeLocalStorageSetItem = (key: string, value: string): boolean => {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`[storage] Failed to persist "${key}"`, error);
        return false;
    }
};

const toPersistBoard = (board: Board, mode: 'full' | 'single'): Board => {
    const safeElements = Array.isArray(board.elements) ? board.elements : [];
    const safeHistoryRaw = Array.isArray(board.history) ? board.history.filter(Array.isArray) : [];
    const compactHistory =
        mode === 'single'
            ? [safeElements]
            : (safeHistoryRaw.length > 0 ? safeHistoryRaw : [safeElements]).slice(-MAX_PERSIST_BOARD_HISTORY);

    return {
        ...board,
        elements: safeElements,
        history: compactHistory,
        historyIndex: Math.min(Math.max(0, board.historyIndex ?? 0), compactHistory.length - 1),
    };
};

const persistBoardsSafely = (boards: Board[]): boolean => {
    const normalizedBoards = boards.map(board => toPersistBoard(board, 'full'));
    if (safeLocalStorageSetItem(BOARDS_STORAGE_KEY, JSON.stringify(normalizedBoards))) {
        return true;
    }

    const singleHistoryBoards = boards.map(board => toPersistBoard(board, 'single'));
    if (safeLocalStorageSetItem(BOARDS_STORAGE_KEY, JSON.stringify(singleHistoryBoards))) {
        return true;
    }

    const trimmedBoards = singleHistoryBoards.slice(-MAX_PERSIST_BOARD_COUNT);
    return safeLocalStorageSetItem(BOARDS_STORAGE_KEY, JSON.stringify(trimmedBoards));
};

const escapeXmlAttr = (input: string): string =>
    input
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

function buildImageSizeByRatio(resolution: string, aspectRatio: string): string {
    const parsed = resolution.match(/^(\d+)x(\d+)$/);
    const base = parsed ? Math.max(Number(parsed[1]), Number(parsed[2])) : 1024;

    const ratioMap: Record<string, [number, number]> = {
        '1:1': [1, 1],
        '4:3': [4, 3],
        '3:4': [3, 4],
        '16:9': [16, 9],
        '9:16': [9, 16],
    };
    const ratio = ratioMap[aspectRatio] || ratioMap['1:1'];
    const maxRatioSide = Math.max(ratio[0], ratio[1]);
    const scale = base / maxRatioSide;
    const width = Math.max(64, Math.round((ratio[0] * scale) / 64) * 64);
    const height = Math.max(64, Math.round((ratio[1] * scale) / 64) * 64);
    return `${width}x${height}`;
}

const THEME_PALETTES = {
    light: {
        appBackground: '#f3f5f9',
        canvasBackground: '#f7f8fb',
        uiBgColor: 'rgba(255, 255, 255, 0.92)',
        buttonBgColor: '#111827',
    },
    dark: {
        appBackground: '#0c0f14',
        canvasBackground: '#11151c',
        uiBgColor: 'rgba(18, 21, 27, 0.94)',
        buttonBgColor: '#f3f4f6',
    },
} as const;

const inferCapabilitiesByProvider = (provider: AIProvider): AICapability[] => {
    switch (provider) {
        case 'google':
            return ['text', 'image', 'video'];
        case 'openai':
            return ['text', 'image'];
        case 'anthropic':
        case 'qwen':
            return ['text'];
        case 'stability':
            return ['image'];
        case 'banana':
            return ['agent'];
        case 'custom':
            return ['text', 'image', 'video'];
        default:
            return ['text'];
    }
};

const normalizeApiKeyEntry = (item: Partial<UserApiKey>): UserApiKey | null => {
    if (!item || !item.id || !item.provider || !item.key) return null;
    return {
        id: item.id,
        provider: item.provider,
        capabilities:
            Array.isArray(item.capabilities) && item.capabilities.length > 0
                ? item.capabilities
                : inferCapabilitiesByProvider(item.provider),
        key: item.key,
        baseUrl: item.baseUrl,
        name: item.name,
        isDefault: item.isDefault,
        status: item.status,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
    };
};

const hasCapabilityOverlap = (left: AICapability[], right: AICapability[]) =>
    left.some(capability => right.includes(capability));

const loadBoardsFromStorage = (): Board[] => {
    try {
        const raw = localStorage.getItem(BOARDS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return [createNewBoard('Board 1')];
        }

        const boards = parsed
            .map((board: Partial<Board>) => {
                if (!board || typeof board.id !== 'string' || typeof board.name !== 'string' || !Array.isArray(board.elements)) {
                    return null;
                }

                const elements = board.elements;
                const historyRaw = Array.isArray(board.history) ? board.history.filter(Array.isArray) : [];
                const history = historyRaw.length > 0 ? historyRaw : [elements];
                const historyIndex = Math.min(Math.max(0, Number(board.historyIndex ?? 0)), history.length - 1);
                const panOffset = board.panOffset && Number.isFinite(board.panOffset.x) && Number.isFinite(board.panOffset.y)
                    ? board.panOffset
                    : { x: 0, y: 0 };
                const zoom = Number.isFinite(board.zoom) ? Math.max(0.05, Number(board.zoom)) : 1;
                const canvasBackgroundColor = typeof board.canvasBackgroundColor === 'string'
                    ? board.canvasBackgroundColor
                    : '#FFFFFF';

                return {
                    id: board.id,
                    name: board.name,
                    elements,
                    history,
                    historyIndex,
                    panOffset,
                    zoom,
                    canvasBackgroundColor,
                } as Board;
            })
            .filter((board): board is Board => !!board);

        return boards.length > 0 ? boards : [createNewBoard('Board 1')];
    } catch {
        return [createNewBoard('Board 1')];
    }
};

type RuntimeIssue = {
    id: string;
    title: string;
    detail?: string;
    timestamp: number;
};

const App: React.FC = () => {
    const [boards, setBoards] = useState<Board[]>(() => loadBoardsFromStorage());
    const [activeBoardId, setActiveBoardId] = useState<string>(() => {
        try {
            const saved = localStorage.getItem(ACTIVE_BOARD_STORAGE_KEY);
            return saved || '';
        } catch {
            return '';
        }
    });

    const activeBoard = useMemo(() => {
        return boards.find(b => b.id === activeBoardId) ?? boards[0];
    }, [boards, activeBoardId]);

    const { elements, history, historyIndex, panOffset, zoom } = activeBoard;

    const [activeTool, setActiveTool] = useState<Tool>('select');
    const [drawingOptions, setDrawingOptions] = useState({ strokeColor: '#111827', strokeWidth: 5 });
    const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
    const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
    const [prompt, setPrompt] = useState('');
    const [promptAttachments, setPromptAttachments] = useState<ChatAttachment[]>([]);
    const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
    // @ 鐎殿喗娲滈弫銈夊礂閸愵亞顦?id 闁告帗顨夐妴鍐晬閸垺鏆?PromptBar 闁革负鍔庨弫銈夊箣妞嬪骸浠柛鎴ｅ吹閺佹捇骞嬮幇顒€顤呴柛姘湰椤掔偞娼婚崶銊﹂檷闁?
    const [mentionedElementIds, setMentionedElementIds] = useState<string[]>([]);
    const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
    // Force startup chrome into compact mode (as requested UI default):
    // left layer panel collapsed + right inspiration panel collapsed.
    const [isLayerMinimized, setIsLayerMinimized] = useState(true);
    const [isInspirationMinimized, setIsInspirationMinimized] = useState(true);
    const [toolbarLeft, setToolbarLeft] = useState(68); // 鐎规悶鍎遍崣鍧楀冀韫囨洘鐣?left 濞达絽绉堕悿?
    const [rightPanelWidth, setRightPanelWidth] = useState(2); // 闁告瑥鍘栭弲鍫曟閵忊剝绶查悗鍦仱濡绢垳鈧妫勭€规娊鏁嶉崼銏℃殢闁?PromptBar 闁告艾鏈鐐烘晸?
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    const [wheelAction, setWheelAction] = useState<WheelAction>('zoom');
    const [croppingState, setCroppingState] = useState<{ elementId: string; originalElement: ImageElement; cropBox: Rect } | null>(null);
    const [alignmentGuides, setAlignmentGuides] = useState<Guide[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId: string | null } | null>(null);
    const [assetLibrary, setAssetLibrary] = useState<AssetLibrary>(() => loadAssetLibrary());
    const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>(() => loadGenerationHistory());
    const [isAssetPanelOpen, setIsAssetPanelOpen] = useState(false);
    const [addAssetModal, setAddAssetModal] = useState<{ open: boolean; dataUrl: string; mimeType: string; width: number; height: number } | null>(null);
    
    // Persist minimize state
    useEffect(() => {
        safeLocalStorageSetItem('layerPanelMinimized', isLayerMinimized.toString());
    }, [isLayerMinimized]);
    
    useEffect(() => {
        safeLocalStorageSetItem('inspirationPanelMinimized', isInspirationMinimized.toString());
    }, [isInspirationMinimized]);

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const chromeMetrics = useMemo(() => getCompactChromeMetrics(viewportWidth), [viewportWidth]);

    useEffect(() => {
        persistBoardsSafely(boards);
    }, [boards]);

    useEffect(() => {
        if (!activeBoardId) return;
        safeLocalStorageSetItem(ACTIVE_BOARD_STORAGE_KEY, activeBoardId);
    }, [activeBoardId]);
    
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const updateTheme = (event?: MediaQueryListEvent) => {
            setSystemTheme((event ? event.matches : media.matches) ? 'dark' : 'light');
        };

        updateTheme();
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', updateTheme);
            return () => media.removeEventListener('change', updateTheme);
        }

        media.addListener(updateTheme);
        return () => media.removeListener(updateTheme);
    }, []);

    const [editingElement, setEditingElement] = useState<{ id: string; text: string; } | null>(null);
    const [lassoPath, setLassoPath] = useState<Point[] | null>(null);

    const [language, setLanguage] = useState<'en' | 'zho'>('en');
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
        try {
            const saved = localStorage.getItem('themeMode.v1');
            return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
        } catch {
            return 'system';
        }
    });
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window === 'undefined') return 'light';
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });
    useEffect(() => {
        safeLocalStorageSetItem('themeMode.v1', themeMode);
    }, [themeMode]);
    const [userApiKeys, setUserApiKeys] = useState<UserApiKey[]>([]);
    const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
    // 鏂扮敤鎴峰紩瀵煎脊绐楋細API Key 鍔犺浇瀹屾垚涓旀棤浠讳綍 Key 鏃惰嚜鍔ㄦ樉绀?
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [clearKeysOnExit, setClearKeysOnExit] = useState<boolean>(() => {
        try { return localStorage.getItem('security.clearKeysOnExit') === 'true'; } catch { return false; }
    });
    const [modelPreference, setModelPreference] = useState<ModelPreference>(() => {
        try {
            const raw = localStorage.getItem('modelPreference.v1');
            return raw ? { ...DEFAULT_MODEL_PREFS, ...JSON.parse(raw) } : DEFAULT_MODEL_PREFS;
        } catch {
            return DEFAULT_MODEL_PREFS;
        }
    });
    
    const [userEffects, setUserEffects] = useState<UserEffect[]>(() => {
        try {
            const saved = localStorage.getItem('userEffects');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error("Failed to parse user effects from localStorage", error);
            return [];
        }
    });
    const [characterLocks, setCharacterLocks] = useState<CharacterLockProfile[]>(() => {
        try {
            const raw = localStorage.getItem('characterLocks.v1');
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });
    const [activeCharacterLockId, setActiveCharacterLockId] = useState<string | null>(() => {
        return localStorage.getItem('characterLocks.activeId') || null;
    });
    
    const [generationMode, setGenerationMode] = useState<'image' | 'video' | 'keyframe'>('image');
    const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
    const [imageResolution, setImageResolution] = useState<string>(() => {
        try {
            const saved = localStorage.getItem('imageResolution.v1');
            return saved && IMAGE_RESOLUTION_OPTIONS.includes(saved as (typeof IMAGE_RESOLUTION_OPTIONS)[number]) ? saved : '1024x1024';
        } catch {
            return '1024x1024';
        }
    });
    const [imageAspectRatio, setImageAspectRatio] = useState<string>(() => {
        try {
            const saved = localStorage.getItem('imageAspectRatio.v1');
            return saved && IMAGE_ASPECT_RATIO_OPTIONS.includes(saved as (typeof IMAGE_ASPECT_RATIO_OPTIONS)[number]) ? saved : '1:1';
        } catch {
            return '1:1';
        }
    });
    const [progressMessage, setProgressMessage] = useState<string>('');
    const [runtimeIssue, setRuntimeIssue] = useState<RuntimeIssue | null>(null);
    const [isAutoEnhanceEnabled, setIsAutoEnhanceEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('autoEnhance.v1') === 'true'; } catch { return false; }
    });

    // 鈹€鈹€ API 閰嶇疆绠＄悊 Store 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    const apiConfigStore = useAPIConfigStore();

    // 鏍规嵁鐢ㄦ埛宸查厤缃殑 API Key 鍔ㄦ€佽绠楀彲閫夋ā鍨嬪垪琛?
    const dynamicModelOptions = useMemo(() => {
        const textSet = new Set<string>();
        const imageSet = new Set<string>();
        const videoSet = new Set<string>();
        for (const key of userApiKeys) {
            const providerModels = PROVIDER_MODELS[key.provider];
            if (!providerModels) continue;
            const caps = key.capabilities?.length ? key.capabilities : inferCapabilitiesByProvider(key.provider);
            if (caps.includes('text'))  providerModels.text.forEach(m => textSet.add(m));
            if (caps.includes('image')) providerModels.image.forEach(m => imageSet.add(m));
            if (caps.includes('video')) providerModels.video.forEach(m => videoSet.add(m));
        }
        return {
            text:  textSet.size > 0 ? Array.from(textSet) : FALLBACK_TEXT_OPTIONS,
            image: imageSet.size > 0 ? Array.from(imageSet) : FALLBACK_IMAGE_OPTIONS,
            video: videoSet.size > 0 ? Array.from(videoSet) : FALLBACK_VIDEO_OPTIONS,
        };
    }, [userApiKeys]);

    useEffect(() => {
        if (!apiKeysLoaded) return;
        setModelPreference(prev => {
            const next = { ...prev };
            let changed = false;

            if (!dynamicModelOptions.text.includes(next.textModel)) {
                next.textModel = ENV_CUSTOM_DEFAULT_TEXT_MODEL || dynamicModelOptions.text[0] || next.textModel;
                changed = true;
            }
            if (!dynamicModelOptions.image.includes(next.imageModel)) {
                next.imageModel = ENV_CUSTOM_DEFAULT_IMAGE_MODEL || dynamicModelOptions.image[0] || next.imageModel;
                changed = true;
            }
            if (dynamicModelOptions.video.length > 0 && !dynamicModelOptions.video.includes(next.videoModel)) {
                next.videoModel = dynamicModelOptions.video[0];
                changed = true;
            }

            return changed ? next : prev;
        });
    }, [apiKeysLoaded, dynamicModelOptions]);

    // 鎸佷箙鍖?autoEnhance 寮€鍏?
    useEffect(() => {
        safeLocalStorageSetItem('autoEnhance.v1', isAutoEnhanceEnabled.toString());
    }, [isAutoEnhanceEnabled]);
    useEffect(() => {
        safeLocalStorageSetItem('imageResolution.v1', imageResolution);
    }, [imageResolution]);
    useEffect(() => {
        safeLocalStorageSetItem('imageAspectRatio.v1', imageAspectRatio);
    }, [imageAspectRatio]);

    const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;
    const themePalette = THEME_PALETTES[resolvedTheme];
    const canvasBackgroundColor = themePalette.canvasBackground;

    const interactionMode = useRef<string | null>(null);
    const startPoint = useRef<Point>({ x: 0, y: 0 });
    const currentDrawingElementId = useRef<string | null>(null);
    const resizeStartInfo = useRef<{ originalElement: ImageElement | ShapeElement | TextElement | VideoElement; startCanvasPoint: Point; handle: string; shiftKey: boolean } | null>(null);
    const cropStartInfo = useRef<{ originalCropBox: Rect, startCanvasPoint: Point } | null>(null);
    const dragStartElementPositions = useRef<Map<string, {x: number, y: number} | Point[]>>(new Map());
    const elementsRef = useRef(elements);
    const svgRef = useRef<SVGSVGElement>(null);
    const editingTextareaRef = useRef<HTMLTextAreaElement>(null);
    const previousToolRef = useRef<Tool>('select');
    const spacebarDownTime = useRef<number | null>(null);
    elementsRef.current = elements;

    const reportRuntimeIssue = useCallback((title: string, detail?: string) => {
        setRuntimeIssue({
            id: generateId(),
            title,
            detail,
            timestamp: Date.now(),
        });
    }, []);

    useEffect(() => {
        const onWindowError = (event: ErrorEvent) => {
            const title = event.message || 'Unhandled runtime error';
            const detail = event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`;
            reportRuntimeIssue(title, detail);
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason as any;
            const title = reason?.message || 'Unhandled promise rejection';
            const detail =
                reason?.stack ||
                (typeof reason === 'string' ? reason : JSON.stringify(reason, null, 2));
            reportRuntimeIssue(title, detail);
        };

        window.addEventListener('error', onWindowError);
        window.addEventListener('unhandledrejection', onUnhandledRejection);
        return () => {
            window.removeEventListener('error', onWindowError);
            window.removeEventListener('unhandledrejection', onUnhandledRejection);
        };
    }, [reportRuntimeIssue]);

    useEffect(() => {
        setSelectedElementIds([]);
        setEditingElement(null);
        setCroppingState(null);
        setSelectionBox(null);
        setPrompt('');
    }, [activeBoardId]);

    useEffect(() => {
        if (!boards.length) return;
        if (!boards.some(board => board.id === activeBoardId)) {
            setActiveBoardId(boards[0].id);
        }
    }, [boards, activeBoardId]);
    
    useEffect(() => {
        try {
            localStorage.setItem('userEffects', JSON.stringify(userEffects));
        } catch (error) {
            console.error("Failed to save user effects to localStorage", error);
        }
    }, [userEffects]);

    // 浠庡姞瀵嗗瓨鍌ㄥ紓姝ュ姞杞?API Key锛堥娆℃寕杞?+ 鍏煎杩佺Щ鏃ф槑鏂囷級
    useEffect(() => {
        let cancelled = false;
        (async () => {
            await migrateLegacyKeys();
            const keys = await loadKeysDecrypted<Partial<UserApiKey>[]>();
            if (cancelled) return;
            const normalized = (keys || [])
                .map(normalizeApiKeyEntry)
                .filter((item): item is UserApiKey => !!item);

            let merged = normalized.filter(item => item.id !== ENV_CUSTOM_TEXT_KEY_ID && item.id !== ENV_CUSTOM_IMAGE_KEY_ID);
            const now = Date.now();

            if (ENV_CUSTOM_IMAGE_API_KEY && ENV_CUSTOM_IMAGE_API_BASE_URL) {
                merged = [
                    {
                        id: ENV_CUSTOM_IMAGE_KEY_ID,
                        provider: 'custom',
                        capabilities: ['image'],
                        key: ENV_CUSTOM_IMAGE_API_KEY,
                        baseUrl: ENV_CUSTOM_IMAGE_API_BASE_URL,
                        name: ENV_CUSTOM_IMAGE_API_NAME,
                        isDefault: true,
                        status: 'ok',
                        createdAt: now,
                        updatedAt: now,
                    },
                    ...merged,
                ];
            }

            if (ENV_CUSTOM_TEXT_API_KEY && ENV_CUSTOM_TEXT_API_BASE_URL) {
                merged = [
                    {
                        id: ENV_CUSTOM_TEXT_KEY_ID,
                        provider: 'custom',
                        capabilities: ['text'],
                        key: ENV_CUSTOM_TEXT_API_KEY,
                        baseUrl: ENV_CUSTOM_TEXT_API_BASE_URL,
                        name: ENV_CUSTOM_TEXT_API_NAME,
                        isDefault: true,
                        status: 'ok',
                        createdAt: now,
                        updatedAt: now,
                    },
                    ...merged,
                ];
            }

            const defaultByCap: Record<AICapability, string | null> = { text: null, image: null, video: null, agent: null };
            for (const item of merged) {
                const caps = item.capabilities?.length ? item.capabilities : inferCapabilitiesByProvider(item.provider);
                for (const cap of caps) {
                    if (!defaultByCap[cap]) defaultByCap[cap] = item.id;
                }
            }
            merged = merged.map(item => {
                const caps = item.capabilities?.length ? item.capabilities : inferCapabilitiesByProvider(item.provider);
                const isDefaultForAnyCap = caps.some(cap => defaultByCap[cap] === item.id);
                return { ...item, isDefault: isDefaultForAnyCap };
            });

            setUserApiKeys(merged);
            setApiKeysLoaded(true);
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!apiKeysLoaded) return;
        setModelPreference(prev => ({
            ...prev,
            textModel: ENV_CUSTOM_DEFAULT_TEXT_MODEL || prev.textModel,
            imageModel: ENV_CUSTOM_DEFAULT_IMAGE_MODEL || prev.imageModel,
        }));
    }, [apiKeysLoaded]);

    // 鎸佷箙鍖?API Key锛堝姞瀵嗗啓鍏ワ級
    useEffect(() => {
        if (!apiKeysLoaded) return; // 闃叉鍒濆绌烘暟缁勮鐩栧姞瀵嗘暟鎹?
        saveKeysEncrypted(userApiKeys);
    }, [userApiKeys, apiKeysLoaded]);

    // 鏂扮敤鎴峰紩瀵硷細API Key 寮傛鍔犺浇瀹屾垚鍚庯紝濡傛灉娌℃湁浠讳綍 Key 涓旂敤鎴锋湭涓诲姩璺宠繃锛岃嚜鍔ㄥ脊鍑哄紩瀵?
    useEffect(() => {
        if (!apiKeysLoaded) return;
        const hasSkipped = localStorage.getItem('onboarding.skipped') === 'true';
        if (userApiKeys.length === 0 && !hasSkipped) {
            setShowOnboarding(true);
        } else if (userApiKeys.length > 0) {
            // 鐢ㄦ埛鍦ㄨ缃潰鏉夸腑娣诲姞浜?Key 鈫?鑷姩鍏抽棴寮曞寮圭獥
            setShowOnboarding(false);
        }
    }, [apiKeysLoaded, userApiKeys.length]);

    // 鎸佷箙鍖?clearKeysOnExit 璁剧疆
    useEffect(() => {
        safeLocalStorageSetItem('security.clearKeysOnExit', clearKeysOnExit.toString());
    }, [clearKeysOnExit]);

    // 閫€鍑烘椂娓呴櫎 API Key
    useEffect(() => {
        if (!clearKeysOnExit) return;
        const handleBeforeUnload = () => { clearAllKeyData(); };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [clearKeysOnExit]);

    useEffect(() => {
        safeLocalStorageSetItem('modelPreference.v1', JSON.stringify(modelPreference));
    }, [modelPreference]);

    useEffect(() => {
        safeLocalStorageSetItem('characterLocks.v1', JSON.stringify(characterLocks));
    }, [characterLocks]);

    useEffect(() => {
        if (activeCharacterLockId) {
            safeLocalStorageSetItem('characterLocks.activeId', activeCharacterLockId);
        } else {
            localStorage.removeItem('characterLocks.activeId');
        }
    }, [activeCharacterLockId]);

    useEffect(() => {
        if (activeCharacterLockId && !characterLocks.some(lock => lock.id === activeCharacterLockId)) {
            setActiveCharacterLockId(null);
        }
    }, [characterLocks, activeCharacterLockId]);

    const getPreferredApiKey = useCallback((capability: AICapability, provider?: AIProvider) => {
        const matches = userApiKeys.filter(key => {
            const capabilities = key.capabilities?.length ? key.capabilities : inferCapabilitiesByProvider(key.provider);
            return capabilities.includes(capability) && (!provider || key.provider === provider);
        });
        return matches.find(key => key.isDefault) || matches[0];
    }, [userApiKeys]);

    useEffect(() => {
        const textProvider = inferProviderFromModel(modelPreference.textModel);
        const imageProvider = inferProviderFromModel(modelPreference.imageModel);
        const videoProvider = inferProviderFromModel(modelPreference.videoModel);

        const googleTextKey = getPreferredApiKey('text', 'google');
        const googleImageKey = getPreferredApiKey('image', 'google');
        const googleVideoKey = getPreferredApiKey('video', 'google');
        const bananaKey = getPreferredApiKey('agent', 'banana');

        setGeminiRuntimeConfig({
            textApiKey: googleTextKey?.key,
            imageApiKey: googleImageKey?.key || googleTextKey?.key,
            videoApiKey: googleVideoKey?.key || googleImageKey?.key || googleTextKey?.key,
            textModel: textProvider === 'google' ? modelPreference.textModel : undefined,
            imageModel:
                imageProvider === 'google' && modelPreference.imageModel.startsWith('gemini')
                    ? modelPreference.imageModel
                    : undefined,
            textToImageModel:
                imageProvider === 'google' && modelPreference.imageModel.startsWith('imagen')
                    ? modelPreference.imageModel
                    : undefined,
            videoModel: videoProvider === 'google' ? modelPreference.videoModel : undefined,
        });
        setBananaRuntimeConfig({
            apiKey: bananaKey?.key,
            splitUrl: bananaKey?.baseUrl ? `${bananaKey.baseUrl.replace(/\/$/, '')}/split-layers` : undefined,
            agentUrl: bananaKey?.baseUrl ? `${bananaKey.baseUrl.replace(/\/$/, '')}/agent` : undefined,
        });
    }, [getPreferredApiKey, modelPreference]);

    const handleAddUserEffect = useCallback((effect: UserEffect) => {
        setUserEffects(prev => [...prev, effect]);
    }, []);

    const handleDeleteUserEffect = useCallback((id: string) => {
        setUserEffects(prev => prev.filter(effect => effect.id !== id));
    }, []);

    const handleAddApiKey = useCallback((payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => {
        const now = Date.now();
        const capabilities = payload.capabilities?.length ? payload.capabilities : inferCapabilitiesByProvider(payload.provider);
        const nextKey: UserApiKey = {
            ...payload,
            capabilities,
            id: generateId(),
            createdAt: now,
            updatedAt: now,
        };
        setUserApiKeys(prev => {
            const isFirstOfCapabilities = !prev.some(k =>
                hasCapabilityOverlap(
                    k.capabilities?.length ? k.capabilities : inferCapabilitiesByProvider(k.provider),
                    capabilities
                )
            );
            const shouldSetDefault = payload.isDefault || isFirstOfCapabilities;
            const withDefault = shouldSetDefault
                ? prev.map(k => {
                    const existingCaps = k.capabilities?.length ? k.capabilities : inferCapabilitiesByProvider(k.provider);
                    return hasCapabilityOverlap(existingCaps, capabilities)
                        ? { ...k, isDefault: false }
                        : k;
                })
                : prev;
            return [{ ...nextKey, isDefault: shouldSetDefault }, ...withDefault];
        });
    }, []);

    const handleDeleteApiKey = useCallback((id: string) => {
        setUserApiKeys(prev => prev.filter(k => k.id !== id));
    }, []);

    const handleUpdateApiKey = useCallback((id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => {
        setUserApiKeys(prev => prev.map(k =>
            k.id === id ? { ...k, ...patch, updatedAt: Date.now() } : k
        ));
    }, []);

    const handleSetDefaultApiKey = useCallback((id: string) => {
        setUserApiKeys(prev => {
            const target = prev.find(k => k.id === id);
            if (!target) return prev;
            const targetCaps = target.capabilities?.length ? target.capabilities : inferCapabilitiesByProvider(target.provider);
            return prev.map(k => {
                const existingCaps = k.capabilities?.length ? k.capabilities : inferCapabilitiesByProvider(k.provider);
                return hasCapabilityOverlap(existingCaps, targetCaps)
                    ? { ...k, isDefault: k.id === id }
                    : k;
            });
        });
    }, []);

    const selectedSingleImage = useMemo<ImageElement | null>(() => {
        if (selectedElementIds.length !== 1) return null;
        const selected = elements.find(el => el.id === selectedElementIds[0]);
        return selected && selected.type === 'image' ? selected : null;
    }, [elements, selectedElementIds]);

    const activeCharacterLock = useMemo(() => {
        if (!activeCharacterLockId) return null;
        return characterLocks.find(lock => lock.id === activeCharacterLockId) || null;
    }, [activeCharacterLockId, characterLocks]);

    const handleLockCharacterFromSelection = useCallback((name?: string) => {
        if (!selectedSingleImage) {
            setError('Please select an image before locking a character.');
            return;
        }
        const lockName = name?.trim() || selectedSingleImage.name || `Character ${characterLocks.length + 1}`;
        const descriptor = [
            `Character lock: ${lockName}.`,
            'Keep face, hairstyle, costume, body shape, and age consistent across all shots.',
            'Do not alter identity unless explicitly requested.',
        ].join(' ');

        const next: CharacterLockProfile = {
            id: generateId(),
            name: lockName,
            anchorElementId: selectedSingleImage.id,
            referenceImage: selectedSingleImage.href,
            descriptor,
            createdAt: Date.now(),
            isActive: true,
        };

        setCharacterLocks(prev => [...prev.map(lock => ({ ...lock, isActive: false })), next]);
        setActiveCharacterLockId(next.id);
        setError(null);
    }, [selectedSingleImage, characterLocks.length]);

    const getPromptMemoryExamples = useCallback((targetPrompt: string): string[] => {
        const normalize = (text: string) =>
            text
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, ' ')
                .split(/\s+/)
                .filter(token => token.length >= 3);

        const targetTokens = new Set(normalize(targetPrompt));
        if (targetTokens.size === 0) return [];

        const scored = generationHistory
            .filter(item => item.mediaType !== 'video' && !!item.prompt?.trim())
            .map(item => {
                const promptText = item.prompt.trim();
                const tokens = new Set(normalize(promptText));
                let overlap = 0;
                targetTokens.forEach(token => {
                    if (tokens.has(token)) overlap += 1;
                });
                const jaccard = overlap / Math.max(1, targetTokens.size + tokens.size - overlap);
                const qualityBoost = Math.min(0.35, (item.promptScore || 0) / 200);
                const modelBoost = item.promptModel === modelPreference.imageModel ? 0.12 : 0;
                const ageWeeks = Math.max(0, (Date.now() - item.createdAt) / (1000 * 60 * 60 * 24 * 7));
                const recencyBoost = ageWeeks === 0 ? 0.08 : Math.min(0.08, 0.08 / Math.max(1, ageWeeks));
                return {
                    prompt: promptText,
                    score: jaccard + qualityBoost + modelBoost + recencyBoost,
                    createdAt: item.createdAt,
                    promptScore: item.promptScore || 0,
                };
            })
            .filter(item => item.score > 0.02)
            .sort((a, b) => (b.score - a.score) || (b.promptScore - a.promptScore) || (b.createdAt - a.createdAt));

        const unique = new Set<string>();
        const examples: string[] = [];
        for (const item of scored) {
            if (unique.has(item.prompt)) continue;
            unique.add(item.prompt);
            examples.push(item.prompt);
            if (examples.length >= 3) break;
        }
        return examples;
    }, [generationHistory, modelPreference.imageModel]);

    const handleEnhancePrompt = useCallback(async (payload: {
        prompt: string;
        mode: PromptEnhanceMode;
        stylePreset?: string;
        memoryExamples?: string[];
    }) => {
        setIsEnhancingPrompt(true);
        try {
            const provider = inferProviderFromModel(modelPreference.textModel);
            const key = getPreferredApiKey('text', provider);
            const memoryExamples = payload.memoryExamples?.length
                ? payload.memoryExamples
                : getPromptMemoryExamples(payload.prompt);
            const enhancePayload = { ...payload, memoryExamples };
            try {
                return await enhancePromptWithAgentPipeline(enhancePayload, modelPreference.textModel, key);
            } catch (pipelineError) {
                console.warn('[PromptPipeline] multi-agent path failed, fallback to single-step enhance:', pipelineError);
                return await enhancePromptWithProvider(enhancePayload, modelPreference.textModel, key);
            }
        } finally {
            setIsEnhancingPrompt(false);
        }
    }, [getPreferredApiKey, getPromptMemoryExamples, modelPreference.textModel]);

    const handleSetActiveCharacterLock = useCallback((id: string | null) => {
        setActiveCharacterLockId(id);
        setCharacterLocks(prev =>
            prev.map(lock => ({ ...lock, isActive: id ? lock.id === id : false }))
        );
    }, []);

    const saveGenerationToHistory = useCallback((payload: {
        name?: string;
        dataUrl: string;
        originalDataUrl?: string;
        mimeType: string;
        width: number;
        height: number;
        prompt: string;
        mediaType?: 'image' | 'video';
        promptScore?: number;
        promptModel?: string;
        promptNotes?: string;
    }) => {
        const item: GenerationHistoryItem = {
            id: generateId(),
            name: payload.name,
            dataUrl: payload.dataUrl,
            originalDataUrl: payload.originalDataUrl,
            mimeType: payload.mimeType,
            width: payload.width,
            height: payload.height,
            prompt: payload.prompt,
            createdAt: Date.now(),
            mediaType: payload.mediaType,
            promptScore: payload.promptScore,
            promptModel: payload.promptModel,
            promptNotes: payload.promptNotes,
        };

        setGenerationHistory(prev => addGenerationHistoryItem(prev, item));
    }, []);

    const buildHistoryThumbnailFromImage = useCallback((
        img: HTMLImageElement,
        sourceMimeType: string,
        fallbackDataUrl: string
    ): { dataUrl: string; mimeType: string } => {
        try {
            const naturalWidth = img.naturalWidth || img.width;
            const naturalHeight = img.naturalHeight || img.height;
            if (!naturalWidth || !naturalHeight) {
                return { dataUrl: fallbackDataUrl, mimeType: sourceMimeType };
            }

            const MAX_SIDE = 640;
            const scale = Math.min(1, MAX_SIDE / Math.max(naturalWidth, naturalHeight));
            const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
            const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return { dataUrl: fallbackDataUrl, mimeType: sourceMimeType };
            }

            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            const outputMimeType = sourceMimeType === 'image/png' ? 'image/png' : 'image/jpeg';
            const quality = outputMimeType === 'image/jpeg' ? 0.85 : undefined;
            const dataUrl = canvas.toDataURL(outputMimeType, quality);
            return { dataUrl, mimeType: outputMimeType };
        } catch {
            return { dataUrl: fallbackDataUrl, mimeType: sourceMimeType };
        }
    }, []);

    const addChatAttachment = useCallback((payload: Omit<ChatAttachment, 'id'>) => {
        setChatAttachments(prev => {
            const exists = prev.some(item => item.href === payload.href);
            if (exists) return prev;
            return [...prev, { ...payload, id: generateId() }];
        });
    }, []);

    const addPromptAttachment = useCallback((payload: Omit<ChatAttachment, 'id'>) => {
        setPromptAttachments(prev => {
            const exists = prev.some(item => item.href === payload.href);
            if (exists) return prev;
            return [...prev, { ...payload, id: generateId() }];
        });
    }, []);

    const handleAddAttachmentFromCanvas = useCallback((payload: { id: string; name?: string; href: string; mimeType: string }) => {
        addChatAttachment({
            name: payload.name || `Canvas ${payload.id.slice(-4)}`,
            href: payload.href,
            mimeType: payload.mimeType,
            source: 'canvas',
        });
    }, [addChatAttachment]);

    const handleAddAttachmentFiles = useCallback(async (files: FileList | File[]) => {
        const list = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (list.length === 0) return;
        try {
            const dataList = await Promise.all(list.map(fileToDataUrl));
            dataList.forEach((item, index) => {
                addChatAttachment({
                    name: list[index].name || `Upload ${index + 1}`,
                    href: item.dataUrl,
                    mimeType: item.mimeType,
                    source: 'upload',
                });
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Attachment upload failed.';
            setError(message);
        }
    }, [addChatAttachment]);

    const handleAddPromptAttachmentFiles = useCallback(async (files: FileList | File[]) => {
        const list = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (list.length === 0) return;
        try {
            const dataList = await Promise.all(list.map(fileToDataUrl));
            dataList.forEach((item, index) => {
                addPromptAttachment({
                    name: list[index].name || `Upload ${index + 1}`,
                    href: item.dataUrl,
                    mimeType: item.mimeType,
                    source: 'upload',
                });
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Attachment upload failed.';
            setError(message);
        }
    }, [addPromptAttachment]);

    const handleRemoveChatAttachment = useCallback((id: string) => {
        setChatAttachments(prev => prev.filter(item => item.id !== id));
    }, []);

    const handleRemovePromptAttachment = useCallback((id: string) => {
        setPromptAttachments(prev => prev.filter(item => item.id !== id));
    }, []);

    const t = useCallback((key: string, ...args: any[]): any => {
        const keys = key.split('.');
        let result: any = translations[language];
        for (const k of keys) {
            result = result?.[k];
        }
        if (typeof result === 'function') {
            return result(...args);
        }
        return result || key;
    }, [language]);

    useEffect(() => {
        const root = document.documentElement;
        root.dataset.theme = resolvedTheme;
        root.style.setProperty('--ui-bg-color', themePalette.uiBgColor);
        root.style.setProperty('--button-bg-color', themePalette.buttonBgColor);
        document.body.style.backgroundColor = themePalette.appBackground;
    }, [resolvedTheme, themePalette]);

    // (moved below commitAction)

    const updateActiveBoard = (updater: (board: Board) => Board) => {
        setBoards(prevBoards => prevBoards.map(board =>
            board.id === activeBoardId ? updater(board) : board
        ));
    };

    const setElements = (updater: (prev: Element[]) => Element[], commit: boolean = true) => {
        updateActiveBoard(board => {
            const newElements = updater(board.elements);
            if (commit) {
                const newHistory = [...board.history.slice(0, board.historyIndex + 1), newElements];
                return {
                    ...board,
                    elements: newElements,
                    history: newHistory,
                    historyIndex: newHistory.length - 1,
                };
            } else {
                 const tempHistory = [...board.history];
                 tempHistory[board.historyIndex] = newElements;
                 return { ...board, elements: newElements, history: tempHistory };
            }
        });
    };
    
    const commitAction = useCallback((updater: (prev: Element[]) => Element[]) => {
        updateActiveBoard(board => {
            const newElements = updater(board.elements);
            const newHistory = [...board.history.slice(0, board.historyIndex + 1), newElements];
            return {
                ...board,
                elements: newElements,
                history: newHistory,
                historyIndex: newHistory.length - 1,
            };
        });
    }, [activeBoardId]);

    const handleUndo = useCallback(() => {
        updateActiveBoard(board => {
            if (board.historyIndex > 0) {
                return { ...board, historyIndex: board.historyIndex - 1, elements: board.history[board.historyIndex - 1] };
            }
            return board;
        });
    }, [activeBoardId]);

    const handleRedo = useCallback(() => {
        updateActiveBoard(board => {
            if (board.historyIndex < board.history.length - 1) {
                return { ...board, historyIndex: board.historyIndex + 1, elements: board.history[board.historyIndex + 1] };
            }
            return board;
        });
    }, [activeBoardId]);

    // Handle drop from AssetLibraryPanel (after commitAction and getCanvasPoint are defined)
    const handleAssetDropRef = useRef<(e: React.DragEvent) => boolean>();
    handleAssetDropRef.current = (e: React.DragEvent) => {
        const payload = e.dataTransfer.getData('application/x-making-asset') || e.dataTransfer.getData('text/plain');
        try {
            const parsed = JSON.parse(payload);
            if (parsed?.__makingAsset && parsed.item) {
                const item: AssetItem = parsed.item as AssetItem;
                const canvasPoint = getCanvasPoint(e.clientX, e.clientY);
                const img = new Image();
                img.onload = () => {
                    const newImage: ImageElement = {
                        id: generateId(),
                        type: 'image',
                        name: item.name || 'Asset',
                        x: canvasPoint.x - img.width / 2,
                        y: canvasPoint.y - img.height / 2,
                        width: img.width,
                        height: img.height,
                        href: item.dataUrl,
                        mimeType: item.mimeType,
                    };
                    commitAction(prev => [...prev, newImage]);
                    setSelectedElementIds([newImage.id]);
                    setActiveTool('select');
                };
                img.src = item.dataUrl;
                return true;
            }
        } catch {}
        return false;
    };

    const getDescendants = useCallback((elementId: string, allElements: Element[]): Element[] => {
        const descendants: Element[] = [];
        const children = allElements.filter(el => el.parentId === elementId);
        for (const child of children) {
            descendants.push(child);
            if (child.type === 'group') {
                descendants.push(...getDescendants(child.id, allElements));
            }
        }
        return descendants;
    }, []);

    const handleDeleteSelection = useCallback(() => {
        if (selectedElementIds.length === 0) return;
        commitAction(prev => {
            const idsToDelete = new Set<string>(selectedElementIds);
            selectedElementIds.forEach(id => {
                getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
            });
            return prev.filter(el => !idsToDelete.has(el.id));
        });
        setSelectedElementIds([]);
    }, [selectedElementIds, commitAction, getDescendants]);

    const handleStopEditing = useCallback(() => {
        if (!editingElement) return;
        commitAction(prev => prev.map(el =>
            el.id === editingElement.id && el.type === 'text'
                ? { ...el, text: editingElement.text }
                // Persist auto-height change on blur
                : el.id === editingElement.id && el.type === 'text' && editingTextareaRef.current ? { ...el, text: editingElement.text, height: editingTextareaRef.current.scrollHeight }
                : el
        ));
        setEditingElement(null);
    }, [commitAction, editingElement]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (editingElement) {
                if(e.key === 'Escape') handleStopEditing();
                return;
            }

            const target = e.target as HTMLElement;
            const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); return; }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); return; }
            
            if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace') && selectedElementIds.length > 0) {
                e.preventDefault();
                commitAction(prev => {
                    const idsToDelete = new Set(selectedElementIds);
                    selectedElementIds.forEach(id => {
                        getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
                    });
                    return prev.filter(el => !idsToDelete.has(el.id));
                });
                setSelectedElementIds([]);
                return;
            }

            if (e.key === ' ' && !isTyping) {
                e.preventDefault();
                if (spacebarDownTime.current === null) {
                    spacebarDownTime.current = Date.now();
                    previousToolRef.current = activeTool;
                    setActiveTool('pan');
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === ' ' && !editingElement) {
                const target = e.target as HTMLElement;
                const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
                if (isTyping || spacebarDownTime.current === null) return;
                
                e.preventDefault();

                const duration = Date.now() - spacebarDownTime.current;
                spacebarDownTime.current = null;
                
                const toolBeforePan = previousToolRef.current;

                if (duration < 200) { // Tap
                    if (toolBeforePan === 'pan') {
                        setActiveTool('select');
                    } else if (toolBeforePan === 'select') {
                        setActiveTool('pan');
                    } else {
                        setActiveTool('select');
                    }
                } else { // Hold
                    setActiveTool(toolBeforePan);
                }
            }
        };


        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [handleUndo, handleRedo, selectedElementIds, editingElement, activeTool, commitAction, getDescendants, handleStopEditing]);
    
    const getCanvasPoint = useCallback((screenX: number, screenY: number): Point => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const svgBounds = svgRef.current.getBoundingClientRect();
        const xOnSvg = screenX - svgBounds.left;
        const yOnSvg = screenY - svgBounds.top;
        
        return {
            x: (xOnSvg - panOffset.x) / zoom,
            y: (yOnSvg - panOffset.y) / zoom,
        };
    }, [panOffset, zoom]);

    const getInitialDisplayImageSize = useCallback((naturalWidth: number, naturalHeight: number) => {
        if (!svgRef.current || naturalWidth <= 0 || naturalHeight <= 0) {
            return { width: naturalWidth, height: naturalHeight };
        }
        const svgBounds = svgRef.current.getBoundingClientRect();
        const maxScreenWidth = Math.max(320, svgBounds.width * 0.46);
        const maxScreenHeight = Math.max(220, svgBounds.height * 0.42);

        const currentScreenWidth = naturalWidth * zoom;
        const currentScreenHeight = naturalHeight * zoom;
        const fitScale = Math.min(1, maxScreenWidth / currentScreenWidth, maxScreenHeight / currentScreenHeight);

        return {
            width: Math.max(1, Math.round(naturalWidth * fitScale)),
            height: Math.max(1, Math.round(naturalHeight * fitScale)),
        };
    }, [zoom]);

    const handleAddImageElement = useCallback(async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Only image files are supported.');
            return;
        }
        setError(null);
        try {
            const { dataUrl, mimeType } = await fileToDataUrl(file);
            const img = new Image();
            img.onload = () => {
                if (!svgRef.current) return;
                const svgBounds = svgRef.current.getBoundingClientRect();
                const screenCenter = { x: svgBounds.left + svgBounds.width / 2, y: svgBounds.top + svgBounds.height / 2 };
                const canvasPoint = getCanvasPoint(screenCenter.x, screenCenter.y);

                const newImage: ImageElement = {
                    id: generateId(),
                    type: 'image',
                    name: file.name,
                    x: canvasPoint.x - (img.width / 2),
                    y: canvasPoint.y - (img.height / 2),
                    width: img.width,
                    height: img.height,
                    href: dataUrl,
                    mimeType: mimeType,
                };
                setElements(prev => [...prev, newImage]);
                setSelectedElementIds([newImage.id]);
                setActiveTool('select');
            };
            img.src = dataUrl;
        } catch (err) {
            setError('Failed to load image.');
            console.error(err);
        }
    }, [getCanvasPoint, activeBoardId, setElements]);

     const getSelectableElement = (elementId: string, allElements: Element[]): Element | null => {
        const element = allElements.find(el => el.id === elementId);
        if (!element) return null;
        if (element.isLocked) return null;

        let current = element;
        while (current.parentId) {
            const parent = allElements.find(el => el.id === current.parentId);
            if (!parent) return current; // Orphaned, treat as top-level
            if (parent.isLocked) return null; // Parent is locked, nothing inside is selectable
            current = parent;
        }
        return current;
    };
    
    const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
        if (editingElement) return;
        if (contextMenu) setContextMenu(null);

        if (e.button === 1) { // Middle mouse button for panning
            interactionMode.current = 'pan';
            startPoint.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            return;
        }

        startPoint.current = { x: e.clientX, y: e.clientY };
        const canvasStartPoint = getCanvasPoint(e.clientX, e.clientY);

        const target = e.target as SVGElement;
        const handleName = target.getAttribute('data-handle');

        if (croppingState) {
             if (handleName) {
                 interactionMode.current = `crop-${handleName}`;
                 cropStartInfo.current = { originalCropBox: { ...croppingState.cropBox }, startCanvasPoint: canvasStartPoint };
             }
             return;
        }
         if (activeTool === 'text') {
            const newText: TextElement = {
                id: generateId(), type: 'text', name: 'Text',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                width: 150, height: 40,
                text: "Text", fontSize: 24, fontColor: drawingOptions.strokeColor
            };
            setElements(prev => [...prev, newText]);
            setSelectedElementIds([newText.id]);
            setEditingElement({ id: newText.id, text: newText.text });
            setActiveTool('select');
            return;
        }

        if (activeTool === 'pan') {
            interactionMode.current = 'pan';
            return;
        }
        
        if (handleName && activeTool === 'select' && selectedElementIds.length === 1) {
            interactionMode.current = `resize-${handleName}`;
            const element = elements.find(el => el.id === selectedElementIds[0]) as ImageElement | ShapeElement | TextElement | VideoElement;
            resizeStartInfo.current = {
                originalElement: { ...element },
                startCanvasPoint: canvasStartPoint,
                handle: handleName,
                shiftKey: e.shiftKey,
            };
            return;
        }

        if (activeTool === 'draw' || activeTool === 'highlighter') {
            interactionMode.current = 'draw';
            const newPath: PathElement = {
                id: generateId(),
                type: 'path', name: 'Path',
                points: [canvasStartPoint],
                strokeColor: drawingOptions.strokeColor,
                strokeWidth: drawingOptions.strokeWidth,
                strokeOpacity: activeTool === 'highlighter' ? 0.5 : 1,
                x: 0, y: 0 
            };
            currentDrawingElementId.current = newPath.id;
            setElements(prev => [...prev, newPath], false);
        } else if (activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'triangle') {
            interactionMode.current = 'drawShape';
            const newShape: ShapeElement = {
                id: generateId(),
                type: 'shape', name: activeTool.charAt(0).toUpperCase() + activeTool.slice(1),
                shapeType: activeTool,
                x: canvasStartPoint.x,
                y: canvasStartPoint.y,
                width: 0,
                height: 0,
                strokeColor: drawingOptions.strokeColor,
                strokeWidth: drawingOptions.strokeWidth,
                fillColor: 'transparent',
            }
            currentDrawingElementId.current = newShape.id;
            setElements(prev => [...prev, newShape], false);
        } else if (activeTool === 'arrow') {
            interactionMode.current = 'drawArrow';
            const newArrow: ArrowElement = {
                id: generateId(), type: 'arrow', name: 'Arrow',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                points: [canvasStartPoint, canvasStartPoint],
                strokeColor: drawingOptions.strokeColor, strokeWidth: drawingOptions.strokeWidth
            };
            currentDrawingElementId.current = newArrow.id;
            setElements(prev => [...prev, newArrow], false);
        } else if (activeTool === 'line') {
            interactionMode.current = 'drawLine';
            const newLine: LineElement = {
                id: generateId(), type: 'line', name: 'Line',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                points: [canvasStartPoint, canvasStartPoint],
                strokeColor: drawingOptions.strokeColor, strokeWidth: drawingOptions.strokeWidth
            };
            currentDrawingElementId.current = newLine.id;
            setElements(prev => [...prev, newLine], false);
        } else if (activeTool === 'erase') {
            interactionMode.current = 'erase';
        } else if (activeTool === 'lasso') {
            interactionMode.current = 'lasso';
            setLassoPath([canvasStartPoint]);
        } else if (activeTool === 'select') {
            const clickedElementId = target.closest('[data-id]')?.getAttribute('data-id');
            const selectableElement = clickedElementId ? getSelectableElement(clickedElementId, elementsRef.current) : null;
            const selectableElementId = selectableElement?.id;

            if (selectableElementId) {
                if (e.detail === 2 && elements.find(el => el.id === selectableElementId)?.type === 'text') {
                     const textEl = elements.find(el => el.id === selectableElementId) as TextElement;
                     setEditingElement({ id: textEl.id, text: textEl.text });
                     return;
                }
                if (!e.shiftKey && !selectedElementIds.includes(selectableElementId)) {
                     setSelectedElementIds([selectableElementId]);
                } else if (e.shiftKey) {
                    setSelectedElementIds(prev => 
                        prev.includes(selectableElementId) ? prev.filter(id => id !== selectableElementId) : [...prev, selectableElementId]
                    );
                }
                interactionMode.current = 'dragElements';
                const idsToDrag = new Set<string>();
                 if (selectableElement.type === 'group') {
                    idsToDrag.add(selectableElement.id);
                    getDescendants(selectableElement.id, elementsRef.current).forEach(desc => idsToDrag.add(desc.id));
                } else {
                    idsToDrag.add(selectableElement.id);
                }

                 const initialPositions = new Map<string, {x: number, y: number} | Point[]>();
                elementsRef.current.forEach(el => {
                    if (idsToDrag.has(el.id)) {
                         if (el.type !== 'path' && el.type !== 'arrow' && el.type !== 'line') {
                            initialPositions.set(el.id, { x: el.x, y: el.y });
                        } else {
                            initialPositions.set(el.id, el.points);
                        }
                    }
                });
                dragStartElementPositions.current = initialPositions;

            } else {
                setSelectedElementIds([]);
                interactionMode.current = 'selectBox';
                setSelectionBox({ x: canvasStartPoint.x, y: canvasStartPoint.y, width: 0, height: 0 });
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!interactionMode.current) return;
        const point = getCanvasPoint(e.clientX, e.clientY);
        const startCanvasPoint = getCanvasPoint(startPoint.current.x, startPoint.current.y);

        if (interactionMode.current === 'erase') {
            const eraseRadius = drawingOptions.strokeWidth / zoom;
            const idsToDelete = new Set<string>();

            elements.forEach(el => {
                if (el.type === 'path') {
                    for (let i = 0; i < el.points.length - 1; i++) {
                        const distance = Math.hypot(point.x - el.points[i].x, point.y - el.points[i].y);
                        if (distance < eraseRadius) {
                            idsToDelete.add(el.id);
                            return;
                        }
                    }
                }
            });

            if (idsToDelete.size > 0) {
                setElements(prev => prev.filter(el => !idsToDelete.has(el.id)), false);
            }
            return;
        }

        if (interactionMode.current.startsWith('resize-')) {
            if (!resizeStartInfo.current) return;
            const { originalElement, handle, startCanvasPoint: resizeStartPoint, shiftKey } = resizeStartInfo.current;
            let { x, y, width, height } = originalElement;
            const aspectRatio = originalElement.width / originalElement.height;
            const dx = point.x - resizeStartPoint.x;
            const dy = point.y - resizeStartPoint.y;

            if (handle.includes('r')) { width = originalElement.width + dx; }
            if (handle.includes('l')) { width = originalElement.width - dx; x = originalElement.x + dx; }
            if (handle.includes('b')) { height = originalElement.height + dy; }
            if (handle.includes('t')) { height = originalElement.height - dy; y = originalElement.y + dy; }

            if (originalElement.type !== 'text' && !shiftKey) {
                if (handle.includes('r') || handle.includes('l')) {
                    height = width / aspectRatio;
                    if (handle.includes('t')) y = (originalElement.y + originalElement.height) - height;
                } else {
                    width = height * aspectRatio;
                    if (handle.includes('l')) x = (originalElement.x + originalElement.width) - width;
                }
            }

            if (width < 1) { width = 1; x = originalElement.x + originalElement.width - 1; }
            if (height < 1) { height = 1; y = originalElement.y + originalElement.height - 1; }

            setElements(prev => prev.map(el =>
                el.id === originalElement.id ? { ...el, x, y, width, height } : el
            ), false);
            return;
        }

        if (interactionMode.current.startsWith('crop-')) {
            if (!croppingState || !cropStartInfo.current) return;
            const handle = interactionMode.current.split('-')[1];
            const { originalCropBox, startCanvasPoint: cropStartPoint } = cropStartInfo.current;
            let { x, y, width, height } = { ...originalCropBox };
            const { originalElement } = croppingState;
            const dx = point.x - cropStartPoint.x;
            const dy = point.y - cropStartPoint.y;

            if (handle.includes('r')) { width = originalCropBox.width + dx; }
            if (handle.includes('l')) { width = originalCropBox.width - dx; x = originalCropBox.x + dx; }
            if (handle.includes('b')) { height = originalCropBox.height + dy; }
            if (handle.includes('t')) { height = originalCropBox.height - dy; y = originalCropBox.y + dy; }
            
            if (x < originalElement.x) {
                width += x - originalElement.x;
                x = originalElement.x;
            }
            if (y < originalElement.y) {
                height += y - originalElement.y;
                y = originalElement.y;
            }
            if (x + width > originalElement.x + originalElement.width) {
                width = originalElement.x + originalElement.width - x;
            }
            if (y + height > originalElement.y + originalElement.height) {
                height = originalElement.y + originalElement.height - y;
            }

            if (width < 1) {
                width = 1;
                if (handle.includes('l')) { x = originalCropBox.x + originalCropBox.width - 1; }
            }
            if (height < 1) {
                height = 1;
                if (handle.includes('t')) { y = originalCropBox.y + originalCropBox.height - 1; }
            }

            setCroppingState(prev => prev ? { ...prev, cropBox: { x, y, width, height } } : null);
            return;
        }


        switch(interactionMode.current) {
            case 'pan': {
                const dx = e.clientX - startPoint.current.x;
                const dy = e.clientY - startPoint.current.y;
                updateActiveBoard(b => ({ ...b, panOffset: { x: b.panOffset.x + dx, y: b.panOffset.y + dy } }));
                startPoint.current = { x: e.clientX, y: e.clientY };
                break;
            }
            case 'draw': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'path') {
                            return { ...el, points: [...el.points, point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'lasso': {
                setLassoPath(prev => (prev ? [...prev, point] : [point]));
                break;
            }
            case 'drawShape': {
                 if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'shape') {
                            let newWidth = Math.abs(point.x - startCanvasPoint.x);
                            let newHeight = Math.abs(point.y - startCanvasPoint.y);
                            let newX = Math.min(point.x, startCanvasPoint.x);
                            let newY = Math.min(point.y, startCanvasPoint.y);
                            
                            if (e.shiftKey) {
                                if (el.shapeType === 'rectangle' || el.shapeType === 'circle') {
                                    const side = Math.max(newWidth, newHeight);
                                    newWidth = side;
                                    newHeight = side;
                                } else if (el.shapeType === 'triangle') {
                                    newHeight = newWidth * (Math.sqrt(3) / 2);
                                }
                                
                                if (point.x < startCanvasPoint.x) newX = startCanvasPoint.x - newWidth;
                                if (point.y < startCanvasPoint.y) newY = startCanvasPoint.y - newHeight;
                            }

                            return {...el, x: newX, y: newY, width: newWidth, height: newHeight};
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'drawArrow': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'arrow') {
                            return { ...el, points: [el.points[0], point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'drawLine': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'line') {
                            return { ...el, points: [el.points[0], point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'dragElements': {
                const dx = point.x - startCanvasPoint.x;
                const dy = point.y - startCanvasPoint.y;
                
                const movingElementIds = Array.from(dragStartElementPositions.current.keys());
                const movingElements = elements.filter(el => movingElementIds.includes(el.id));
                const otherElements = elements.filter(el => !movingElementIds.includes(el.id));
                const snapThresholdCanvas = SNAP_THRESHOLD / zoom;

                let finalDx = dx;
                let finalDy = dy;
                let activeGuides: Guide[] = [];

                // Alignment Snapping
                const getSnapPoints = (bounds: Rect) => ({
                    v: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
                    h: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
                });

                const staticSnapPoints = { v: new Set<number>(), h: new Set<number>() };
                otherElements.forEach(el => {
                    const bounds = getElementBounds(el);
                    getSnapPoints(bounds).v.forEach(p => staticSnapPoints.v.add(p));
                    getSnapPoints(bounds).h.forEach(p => staticSnapPoints.h.add(p));
                });
                
                let bestSnapX = { dist: Infinity, val: finalDx, guide: null as Guide | null };
                let bestSnapY = { dist: Infinity, val: finalDy, guide: null as Guide | null };
                
                movingElements.forEach(movingEl => {
                    const startPos = dragStartElementPositions.current.get(movingEl.id);
                    if (!startPos) return;

                    let movingBounds: Rect;
                     if (movingEl.type !== 'path' && movingEl.type !== 'arrow' && movingEl.type !== 'line') {
                        movingBounds = getElementBounds({...movingEl, x: (startPos as Point).x, y: (startPos as Point).y });
                    } else { // path or arrow or line
                        if (movingEl.type === 'arrow' || movingEl.type === 'line') {
                            movingBounds = getElementBounds({...movingEl, points: startPos as [Point, Point]});
                        } else {
                            movingBounds = getElementBounds({...movingEl, points: startPos as Point[]});
                        }
                    }

                    const movingSnapPoints = getSnapPoints(movingBounds);

                    movingSnapPoints.v.forEach(p => {
                        staticSnapPoints.v.forEach(staticP => {
                            const dist = Math.abs((p + finalDx) - staticP);
                            if (dist < snapThresholdCanvas && dist < bestSnapX.dist) {
                                bestSnapX = { dist, val: staticP - p, guide: { type: 'v', position: staticP, start: movingBounds.y, end: movingBounds.y + movingBounds.height }};
                            }
                        });
                    });
                    movingSnapPoints.h.forEach(p => {
                        staticSnapPoints.h.forEach(staticP => {
                            const dist = Math.abs((p + finalDy) - staticP);
                            if (dist < snapThresholdCanvas && dist < bestSnapY.dist) {
                                bestSnapY = { dist, val: staticP - p, guide: { type: 'h', position: staticP, start: movingBounds.x, end: movingBounds.x + movingBounds.width }};
                            }
                        });
                    });
                });
                
                if (bestSnapX.guide) { finalDx = bestSnapX.val; activeGuides.push(bestSnapX.guide); }
                if (bestSnapY.guide) { finalDy = bestSnapY.val; activeGuides.push(bestSnapY.guide); }
                
                setAlignmentGuides(activeGuides);

                setElements(prev => prev.map(el => {
                    if (movingElementIds.includes(el.id)) {
                        const startPos = dragStartElementPositions.current.get(el.id);
                        if (!startPos) return el;
                        
                        if (el.type !== 'path' && el.type !== 'arrow' && el.type !== 'line') {
                            return { ...el, x: (startPos as Point).x + finalDx, y: (startPos as Point).y + finalDy };
                        }
                        
                        if (el.type === 'path') {
                            const startPoints = startPos as Point[];
                            const newPoints = startPoints.map(p => ({ x: p.x + finalDx, y: p.y + finalDy }));
                            const updatedEl: PathElement = { ...el, points: newPoints };
                            return updatedEl;
                        } else if (el.type === 'arrow' || el.type === 'line') {
                            const startPoints = startPos as [Point, Point];
                            const newPoints: [Point, Point] = [
                                { x: startPoints[0].x + finalDx, y: startPoints[0].y + finalDy },
                                { x: startPoints[1].x + finalDx, y: startPoints[1].y + finalDy },
                            ];
                            const updatedEl = { ...el, points: newPoints };
                            return updatedEl;
                        }
                    }
                    return el;
                }), false);
                break;
            }
             case 'selectBox': {
                const newX = Math.min(point.x, startCanvasPoint.x);
                const newY = Math.min(point.y, startCanvasPoint.y);
                const newWidth = Math.abs(point.x - startCanvasPoint.x);
                const newHeight = Math.abs(point.y - startCanvasPoint.y);
                setSelectionBox({ x: newX, y: newY, width: newWidth, height: newHeight });
                break;
            }
        }
    };
    
    const handleMouseUp = () => {
        if (interactionMode.current) {
            if (interactionMode.current === 'selectBox' && selectionBox) {
                const selectedIds: string[] = [];
                const { x: sx, y: sy, width: sw, height: sh } = selectionBox;
                
                elements.forEach(element => {
                    const bounds = getElementBounds(element, elements);
                    const { x: ex, y: ey, width: ew, height: eh } = bounds;
                    
                    if (sx < ex + ew && sx + sw > ex && sy < ey + eh && sy + sh > ey) {
                        const selectable = getSelectableElement(element.id, elements);
                        if(selectable) selectedIds.push(selectable.id);
                    }
                });
                setSelectedElementIds([...new Set(selectedIds)]);
            } else if (interactionMode.current === 'lasso' && lassoPath && lassoPath.length > 2) {
                const selectedIds = elements.filter(el => {
                    const bounds = getElementBounds(el, elements);
                    const center: Point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
                    return isPointInPolygon(center, lassoPath);
                }).map(el => getSelectableElement(el.id, elements)?.id).filter((id): id is string => !!id);
                setSelectedElementIds(prev => [...new Set([...prev, ...selectedIds])]);
                setLassoPath(null);
            } else if (['draw', 'drawShape', 'drawArrow', 'drawLine', 'dragElements', 'erase'].some(prefix => interactionMode.current?.startsWith(prefix)) || interactionMode.current.startsWith('resize-')) {
                 commitAction(els => els); // This effectively commits the current state to history
            }
        }
        
        interactionMode.current = null;
        currentDrawingElementId.current = null;
        setSelectionBox(null);
        setLassoPath(null);
        resizeStartInfo.current = null;
        cropStartInfo.current = null;
        setAlignmentGuides([]);
        dragStartElementPositions.current.clear();
    };

    const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
        if (croppingState || editingElement) { e.preventDefault(); return; }
        e.preventDefault();
        const { clientX, clientY, deltaX, deltaY, ctrlKey } = e;

        if (ctrlKey || wheelAction === 'zoom') {
            const zoomFactor = 1.05;
            const oldZoom = zoom;
            const newZoom = deltaY < 0 ? oldZoom * zoomFactor : oldZoom / zoomFactor;
            const clampedZoom = Math.max(0.1, Math.min(newZoom, 10));

            const mousePoint = { x: clientX, y: clientY };
            const newPanX = mousePoint.x - (mousePoint.x - panOffset.x) * (clampedZoom / oldZoom);
            const newPanY = mousePoint.y - (mousePoint.y - panOffset.y) * (clampedZoom / oldZoom);

            updateActiveBoard(b => ({ ...b, zoom: clampedZoom, panOffset: { x: newPanX, y: newPanY }}));

        } else { // Panning (wheelAction === 'pan' and no ctrlKey)
            updateActiveBoard(b => ({ ...b, panOffset: { x: b.panOffset.x - deltaX, y: b.panOffset.y - deltaY }}));
        }
    };

    const handleDeleteElement = (id: string) => {
        commitAction(prev => {
            const idsToDelete = new Set([id]);
            getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
            return prev.filter(el => !idsToDelete.has(el.id));
        });
        setSelectedElementIds(prev => prev.filter(selId => selId !== id));
    };

    const handleCopyElement = (elementToCopy: Element) => {
        commitAction(prev => {
            const elementsToCopy = [elementToCopy, ...getDescendants(elementToCopy.id, prev)];
            const idMap = new Map<string, string>();
            
// FIX: Refactored element creation to use explicit switch cases for each element type.
// This helps TypeScript correctly infer the return type of the map function as Element[],
// preventing type errors caused by spreading a discriminated union.
            const newElements: Element[] = elementsToCopy.map((el): Element => {
                const newId = generateId();
                idMap.set(el.id, newId);
                const dx = 20 / zoom;
                const dy = 20 / zoom;

                switch (el.type) {
                    case 'path':
                        return { ...el, id: newId, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                    case 'arrow':
                        return { ...el, id: newId, points: [{ x: el.points[0].x + dx, y: el.points[0].y + dy }, { x: el.points[1].x + dx, y: el.points[1].y + dy }] as [Point, Point] };
                    case 'line':
                         return { ...el, id: newId, points: [{ x: el.points[0].x + dx, y: el.points[0].y + dy }, { x: el.points[1].x + dx, y: el.points[1].y + dy }] as [Point, Point] };
                    case 'image':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'shape':
                         return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'text':
                         return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'group':
                         return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'video':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                }
            });
            
// FIX: Refactored parentId assignment to use an explicit switch statement.
// This ensures TypeScript can correctly track the types within the Element union
// and avoids errors when returning the new array of elements.
            const finalNewElements: Element[] = newElements.map((el): Element => {
                const parentId = el.parentId ? idMap.get(el.parentId) : undefined;
                switch (el.type) {
                    case 'image': return { ...el, parentId };
                    case 'path': return { ...el, parentId };
                    case 'shape': return { ...el, parentId };
                    case 'text': return { ...el, parentId };
                    case 'arrow': return { ...el, parentId };
                    case 'line': return { ...el, parentId };
                    case 'group': return { ...el, parentId };
                    case 'video': return { ...el, parentId };
                }
            });
            
            setSelectedElementIds([idMap.get(elementToCopy.id)!]);
            return [...prev, ...finalNewElements];
        });
    };
    
     const handleDownloadImage = (element: ImageElement) => {
        const link = document.createElement('a');
        link.href = element.href;
        link.download = `canvas-image-${element.id}.${element.mimeType.split('/')[1] || 'png'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const resolveImageSize = (dataUrl: string, fallback: { width: number; height: number }): Promise<{ width: number; height: number }> =>
        new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.width, height: img.height });
            img.onerror = () => resolve(fallback);
            img.src = dataUrl;
        });

    const insertImageAgentResult = async (
        source: ImageElement,
        dataUrl: string,
        nameSuffix: string,
        resizeByScale?: number,
        outputMimeType?: string
    ) => {
        const rawSize = await resolveImageSize(dataUrl, { width: source.width, height: source.height });
        const scale = resizeByScale && resizeByScale > 0 ? resizeByScale : 1;
        const width = Math.max(1, rawSize.width / scale);
        const height = Math.max(1, rawSize.height / scale);

        const newImage: ImageElement = {
            id: generateId(),
            type: 'image',
            name: `${source.name || 'Image'} / ${nameSuffix}`,
            x: source.x + 24,
            y: source.y + 24,
            width,
            height,
            href: dataUrl,
            mimeType: outputMimeType || source.mimeType,
        };

        commitAction(prev => [...prev, newImage]);
        setSelectedElementIds([newImage.id]);
    };

    const handleSplitImageWithBanana = async (element: ImageElement) => {
        try {
            setIsLoading(true);
            setError(null);
            setProgressMessage('BANANA is splitting the image into layers...');

            const layers = await splitImageByBanana({
                href: element.href,
                mimeType: element.mimeType,
            });

            const normalizedLayers = await Promise.all(
                layers.map(async (layer) => {
                    if (layer.width > 0 && layer.height > 0) return layer;
                    const size = await resolveImageSize(layer.dataUrl, { width: element.width, height: element.height });
                    return { ...layer, width: size.width, height: size.height };
                })
            );

            const insertedIds: string[] = [];
            const hideOriginalAfterSplit = true;
            commitAction((prev) => {
                const sourceIndex = prev.findIndex((el) => el.id === element.id);
                const groupId = generateId();

                const newLayerElements: ImageElement[] = normalizedLayers.map((layer, idx) => {
                    const id = generateId();
                    insertedIds.push(id);
                    return {
                        id,
                        type: 'image',
                        name: `${element.name || 'Image'} / ${layer.name || `Layer ${idx + 1}`}`,
                        x: element.x + layer.offsetX,
                        y: element.y + layer.offsetY,
                        width: layer.width || element.width,
                        height: layer.height || element.height,
                        href: layer.dataUrl,
                        mimeType: 'image/png',
                        parentId: groupId,
                    };
                });

                const minX = Math.min(...newLayerElements.map(layer => layer.x));
                const minY = Math.min(...newLayerElements.map(layer => layer.y));
                const maxX = Math.max(...newLayerElements.map(layer => layer.x + layer.width));
                const maxY = Math.max(...newLayerElements.map(layer => layer.y + layer.height));
                const groupElement: GroupElement = {
                    id: groupId,
                    type: 'group',
                    name: `${element.name || 'Image'} / Banana Group`,
                    x: minX,
                    y: minY,
                    width: Math.max(1, maxX - minX),
                    height: Math.max(1, maxY - minY),
                };

                const next = [...prev];
                if (sourceIndex >= 0) {
                    next.splice(sourceIndex + 1, 0, ...newLayerElements, groupElement);
                } else {
                    next.push(...newLayerElements, groupElement);
                }
                if (hideOriginalAfterSplit) {
                    const idx = next.findIndex(el => el.id === element.id);
                    if (idx >= 0) {
                        next[idx] = { ...next[idx], isVisible: false };
                    }
                }
                return next;
            });

            if (insertedIds.length > 0) {
                setSelectedElementIds(insertedIds);
                setProgressMessage(`BANANA created ${insertedIds.length} layers.`);
            } else {
                setProgressMessage('');
            }
        } catch (err) {
            const error = err as Error;
            setError(`BANANA split failed: ${error.message}`);
        } finally {
            setIsLoading(false);
            setTimeout(() => setProgressMessage(''), 1200);
        }
    };

    const handleUpscaleImageWithBanana = async (element: ImageElement) => {
        try {
            setIsLoading(true);
            setError(null);
            setProgressMessage('BANANA Agent 正在进行超分辨率处理...');
            const result = await runBananaImageAgent(
                { href: element.href, mimeType: element.mimeType },
                'upscale',
                { scale: 2 }
            );
            await insertImageAgentResult(element, result.dataUrl, 'Upscaled x2', 2, result.mimeType);
            setProgressMessage('Upscale completed.');
        } catch (err) {
            const error = err as Error;
            setError(`BANANA upscale failed: ${error.message}`);
        } finally {
            setIsLoading(false);
            setTimeout(() => setProgressMessage(''), 1200);
        }
    };

    const handleRemoveBackgroundWithBanana = async (element: ImageElement) => {
        try {
            setIsLoading(true);
            setError(null);
            setProgressMessage('Removing background...');
            const result = await runBananaImageAgent(
                { href: element.href, mimeType: element.mimeType },
                'remove-background'
            );
            await insertImageAgentResult(element, result.dataUrl, 'Background Removed', undefined, result.mimeType);
            setProgressMessage('Background removal completed.');
        } catch (err) {
            const error = err as Error;
            setError(`Background removal failed: ${error.message}`);
        } finally {
            setIsLoading(false);
            setTimeout(() => setProgressMessage(''), 1200);
        }
    };

    const handleStartCrop = (element: ImageElement) => {
        setActiveTool('select');
        setCroppingState({
            elementId: element.id,
            originalElement: { ...element },
            cropBox: { x: element.x, y: element.y, width: element.width, height: element.height },
        });
    };

    const handleCancelCrop = () => setCroppingState(null);

    const handleConfirmCrop = () => {
        if (!croppingState) return;
        const { elementId, cropBox } = croppingState;
        const elementToCrop = elementsRef.current.find(el => el.id === elementId) as ImageElement;

        if (!elementToCrop) { handleCancelCrop(); return; }
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = cropBox.width;
            canvas.height = cropBox.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { setError("Failed to create canvas context for cropping."); handleCancelCrop(); return; }
            const sx = cropBox.x - elementToCrop.x;
            const sy = cropBox.y - elementToCrop.y;
            ctx.drawImage(img, sx, sy, cropBox.width, cropBox.height, 0, 0, cropBox.width, cropBox.height);
            const newHref = canvas.toDataURL(elementToCrop.mimeType);

            commitAction(prev => prev.map(el => {
                if (el.id === elementId && el.type === 'image') {
                    const updatedEl: ImageElement = {
                        ...el,
                        href: newHref,
                        x: cropBox.x,
                        y: cropBox.y,
                        width: cropBox.width,
                        height: cropBox.height
                    };
                    return updatedEl;
                }
                return el;
            }));
            handleCancelCrop();
        };
        img.onerror = () => { setError("Failed to load image for cropping."); handleCancelCrop(); }
        img.src = elementToCrop.href;
    };
    
    useEffect(() => {
        if (editingElement && editingTextareaRef.current) {
            setTimeout(() => {
                if (editingTextareaRef.current) {
                    editingTextareaRef.current.focus();
                    editingTextareaRef.current.select();
                }
            }, 0);
        }
    }, [editingElement]);
    
    useEffect(() => {
        if (editingElement && editingTextareaRef.current) {
            const textarea = editingTextareaRef.current;
            textarea.style.height = 'auto';
            const newHeight = textarea.scrollHeight;
            textarea.style.height = ''; 

            const currentElement = elementsRef.current.find(el => el.id === editingElement.id);
            if (currentElement && currentElement.type === 'text' && currentElement.height !== newHeight) {
                setElements(prev => prev.map(el => 
                    el.id === editingElement.id && el.type === 'text' 
                    ? { ...el, height: newHeight } 
                    : el
                ), false);
            }
        }
    }, [editingElement?.text, setElements]);

    /**
     * 鏋勫缓甯︽湁鍥剧墖寮曠敤鏍囨敞鐨勬彁绀鸿瘝
     *
     * 灏?prompt 涓殑 @Label 鏍囪锛堝 @Image_1銆丂鍥剧墖_2锛夋浛鎹负鏈夊簭鐨?
     * 銆孾鍙傝€冨浘N]銆嶆爣璁帮紝骞舵寜鍑虹幇椤哄簭杩斿洖瀵瑰簲鐨勫浘鐗囨暟鎹暟缁勩€?
     * 杩欐牱 Gemini API 鏀跺埌鐨?parts 灏辫兘閫氳繃浣嶇疆姝ｇ‘鍖归厤寮曠敤鍏崇郴銆?
     *
     * 渚嬶細
     *   杈撳叆 prompt: "鎶夽Image_1鐨勪汉鐗╂浛鎹负@Image_2鐨勫厰瀛?
     *   杈撳嚭 prompt: "鎶奫鍙傝€冨浘1]鐨勪汉鐗╂浛鎹负[鍙傝€冨浘2]鐨勫厰瀛?
     *   杈撳嚭 orderedImages: [Image_1鐨勬暟鎹? Image_2鐨勬暟鎹甝
     */
    const buildMentionAwarePrompt = useCallback((
        rawPrompt: string,
        mentionedImages: ImageElement[],
    ): { prompt: string; orderedMentionImages: { href: string; mimeType: string }[] } => {
        if (mentionedImages.length === 0) {
            return { prompt: rawPrompt, orderedMentionImages: [] };
        }

        // 鎸夌収 prompt 涓?@label 鍑虹幇鐨勪綅缃帓搴?
        const mentionOrder: { element: ImageElement; index: number }[] = [];
        for (const el of mentionedImages) {
            // 灏濊瘯鍖归厤 @name 鎴?@label锛圕anvasMentionExtension 杈撳嚭鐨勬牸寮忥級
            const escapedName = (el.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`@${escapedName}\\b`, 'i');
            const match = rawPrompt.match(regex);
            mentionOrder.push({ element: el, index: match ? match.index! : Infinity });
        }
        mentionOrder.sort((a, b) => a.index - b.index);

        // 鏇挎崲 prompt 涓殑 @label 鈫?[鍙傝€冨浘N]
        let processedPrompt = rawPrompt;
        const orderedImages: { href: string; mimeType: string }[] = [];
        mentionOrder.forEach(({ element }, idx) => {
            const escapedName = (element.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`@${escapedName}\\b`, 'gi');
            processedPrompt = processedPrompt.replace(regex, `[参考图${idx + 1}]`);
            orderedImages.push({ href: element.href, mimeType: element.mimeType });
        });

        // 濡傛灉鏈夊寮犲弬鑰冨浘锛屽湪 prompt 鍓嶆坊鍔犺鏄?
        if (orderedImages.length > 1) {
            const mapping = orderedImages.map((_, i) => [ref]).join(', ');
            processedPrompt = `以下提示词中包含 ${mapping}，分别对应按顺序传入的参考图片。\n${processedPrompt}`;
        }

        return { prompt: processedPrompt, orderedMentionImages: orderedImages };
    }, []);


    const handleGenerate = async (promptOverride?: string, source: 'prompt' | 'right' = 'prompt') => {
        if (isLoading) return;
        let rawPrompt = (promptOverride ?? prompt).trim();
        let enhancedNegativePrompt = '';
        let promptQualityScore: number | undefined;
        let promptEnhanceNotes: string | undefined;
        if (!rawPrompt) {
            setError('Please enter a prompt.');
            return;
        }

        // 鑷姩娑﹁壊锛氬鏋滃紑鍏冲紑鍚笖鏈夋枃鏈?LLM 鑳藉姏鐨?Key锛屽垯鍏堟鼎鑹?
        const shouldAutoEnhance =
            isAutoEnhanceEnabled &&
            source === 'prompt' &&
            (!promptOverride || promptOverride.trim() === prompt.trim());

        if (shouldAutoEnhance) {
            try {
                setProgressMessage('正在使用 LLM 润色提示词...');
                const enhanced = await handleEnhancePrompt({ prompt: rawPrompt, mode: 'smart' });
                if (enhanced?.enhancedPrompt?.trim()) {
                    rawPrompt = enhanced.enhancedPrompt.trim();
                }
                if (enhanced?.negativePrompt?.trim()) {
                    enhancedNegativePrompt = enhanced.negativePrompt.trim();
                }
                promptEnhanceNotes = enhanced?.notes?.trim() || undefined;
                const scoreMatch = enhanced?.notes?.match(/final=(\d+)/i) || enhanced?.notes?.match(/primary=(\d+)/i);
                if (scoreMatch) {
                    promptQualityScore = Number(scoreMatch[1]);
                }
            } catch (e) {
                console.warn('[Auto-Enhance] 润色失败，使用原始提示词:', e);
            }
        }

        // 棰勬锛氭槸鍚﹂厤缃簡瀵瑰簲鑳藉姏鐨?API Key
        const neededCapability: 'image' | 'video' = generationMode === 'video' ? 'video' : 'image';
        const neededProvider = neededCapability === 'video'
            ? inferProviderFromModel(modelPreference.videoModel)
            : inferProviderFromModel(modelPreference.imageModel);
        const hasKey = userApiKeys.some(k => {
            const caps = k.capabilities?.length ? k.capabilities : [];
            return caps.includes(neededCapability) && k.provider === neededProvider;
        });
        if (!hasKey) {
            setError('No API key found for current generation mode. Please add one in Settings -> API config.');
            setIsSettingsPanelOpen(true);
            return;
        }

        setIsLoading(true);
        setError(null);
        setProgressMessage('正在准备生成...');

        const getMimeFromDataUrl = (href: string) => {
            const match = href.match(/^data:([^;]+);base64,/i);
            return match?.[1] || 'image/png';
        };
        const promptWithQualityConstraints =
            enhancedNegativePrompt && (generationMode === 'image' || generationMode === 'keyframe')
                ? `${rawPrompt}\n\nNegative constraints (must avoid): ${enhancedNegativePrompt}`
                : rawPrompt;

        const effectivePrompt = activeCharacterLock
            ? `${activeCharacterLock.descriptor}\n\n${promptWithQualityConstraints}`
            : promptWithQualityConstraints;
        const promptHistoryMeta = {
            promptScore: promptQualityScore,
            promptModel: modelPreference.imageModel,
            promptNotes: promptEnhanceNotes,
        };
        const characterReferenceImages = activeCharacterLock
            ? [{ href: activeCharacterLock.referenceImage, mimeType: getMimeFromDataUrl(activeCharacterLock.referenceImage) }]
            : [];
        const activeAttachments = source === 'right' ? chatAttachments : promptAttachments;
        const attachmentReferenceImages = activeAttachments.map(item => ({ href: item.href, mimeType: item.mimeType }));
        const imageProvider = inferProviderFromModel(modelPreference.imageModel);
        const preferredImageKey = getPreferredApiKey('image', imageProvider);
        const videoProvider = inferProviderFromModel(modelPreference.videoModel);
        const supportsReferenceEditing =
            imageProvider === 'google'
            || (imageProvider === 'custom'
                && !!preferredImageKey?.baseUrl
                && preferredImageKey.baseUrl.toLowerCase().includes('api.apiyi.com'));
        const imageOutputName = generationMode === 'keyframe' ? 'Keyframe' : 'Generated Image';

        /**
         * ======== 棣栧熬甯у姩鐢绘ā寮?(Keyframe Mode) ========
         *
         * 銆愬姛鑳姐€戠敤鎴烽€変腑鎴?@寮曠敤涓€寮犺捣濮嬪抚鍥剧墖锛孷eo 2.0 浼氬熀浜庤鍥剧墖
         *        鐢熸垚涓€娈靛钩婊戠殑杩囨浮鍔ㄧ敾瑙嗛骞舵斁缃埌鐢诲竷涓娿€?
         *
         * 銆愬弬鑰冨浘浼樺厛绾с€戦€変腑鍥剧墖 > @寮曠敤鍥剧墖
         * 銆愯緭鍑恒€慥ideoElement锛坆lob URL锛夛紝鏀剧疆鍦ㄧ敾甯冧腑蹇?
         *
         * 銆愰檺鍒躲€慥eo API 褰撳墠浠呮敮鎸佸崟寮犲弬鑰冨浘浣滀负璧峰甯э紝
         *        濡傛湁涓ゅ紶浠ヤ笂鍙傝€冨浘浼氬湪鎻愮ず璇嶄腑鎻忚堪杩囨浮鎰忓浘銆?
         */
        if (generationMode === 'keyframe') {
            try {
                // 鍓嶇疆妫€鏌ワ細棣栧熬甯у姩鐢讳粎鏀寔 Google Veo 妯″瀷
                if (videoProvider !== 'google') {
                    throw new Error('Keyframe mode currently supports Google Veo models only.');
                }

                // 鏀堕泦鍙傝€冨抚鍥剧墖锛氫紭鍏堥€変腑鐨?鈫?鐒跺悗 @寮曠敤鐨?
                const mentionedImages = mentionedElementIds
                    .map(id => elements.find(el => el.id === id))
                    .filter((el): el is ImageElement => !!el && el.type === 'image');
                const selectedImages = elements
                    .filter(el => selectedElementIds.includes(el.id) && el.type === 'image') as ImageElement[];
                const allFrameRefs = [...selectedImages, ...mentionedImages];

                // 鑷冲皯闇€瑕?1 寮犲弬鑰冨浘浣滀负璧峰甯?
                if (allFrameRefs.length < 1) {
                    setError('Keyframe mode requires at least one reference image (selected or @mentioned).');
                    setIsLoading(false);
                    return;
                }

                // 鍙栫涓€寮犲浘鐗囦綔涓?Veo 鐨?image 鍙傛暟锛圓PI 鍙帴鍙楀崟寮狅級
                const startFrame = allFrameRefs[0];
                // 濡傛湁 鈮? 寮犲弬鑰冨浘锛屽湪鎻愮ず璇嶄腑鎻忚堪"浠庨甯ц繃娓″埌灏惧抚"
                const keyframePrompt = allFrameRefs.length >= 2
                    ? `Animate a smooth cinematic transition from the first frame to the second frame. ${effectivePrompt}`
                    : `Animate this image with smooth motion. ${effectivePrompt}`;

                setProgressMessage('正在生成首尾帧过渡动画...');
                const { videoBlob, mimeType } = await generateVideo(
                    keyframePrompt,
                    videoAspectRatio,
                    (message) => setProgressMessage(message),
                    { href: startFrame.href, mimeType: startFrame.mimeType }
                );

                // 灏嗚棰?Blob 杞负 URL 骞惰幏鍙栧昂瀵稿厓鏁版嵁
                setProgressMessage('处理中...');
                const videoUrl = URL.createObjectURL(videoBlob);
                const video = document.createElement('video');

                video.onloadedmetadata = () => {
                    if (!svgRef.current) return;

                    // 闄愬埗鏈€澶у昂瀵?800px 浠ュ厤鐢诲竷鍏冪礌杩囧ぇ
                    let newWidth = video.videoWidth;
                    let newHeight = video.videoHeight;
                    const MAX_DIM = 800;
                    if (newWidth > MAX_DIM || newHeight > MAX_DIM) {
                        const ratio = newWidth / newHeight;
                        if (ratio > 1) { newWidth = MAX_DIM; newHeight = MAX_DIM / ratio; }
                        else { newHeight = MAX_DIM; newWidth = MAX_DIM * ratio; }
                    }

                    // 鏀剧疆鍒扮敾甯冨彲瑙嗗尯鍩熶腑蹇?
                    const svgBounds = svgRef.current!.getBoundingClientRect();
                    const screenCenter = { x: svgBounds.left + svgBounds.width / 2, y: svgBounds.top + svgBounds.height / 2 };
                    const canvasPoint = getCanvasPoint(screenCenter.x, screenCenter.y);

                    const newVideoElement: VideoElement = {
                        id: generateId(), type: 'video', name: 'Keyframe Animation',
                        x: canvasPoint.x - (newWidth / 2), y: canvasPoint.y - (newHeight / 2),
                        width: newWidth, height: newHeight,
                        href: videoUrl, mimeType,
                    };
                    commitAction(prev => [...prev, newVideoElement]);
                    setSelectedElementIds([newVideoElement.id]);

                    // 鎴彇瑙嗛绗竴甯т綔涓虹缉鐣ュ浘淇濆瓨鍒板巻鍙茶褰?
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(video, 0, 0);
                            const thumbnailUrl = canvas.toDataURL('image/png');
                            saveGenerationToHistory({
                                name: 'Keyframe Animation',
                                dataUrl: thumbnailUrl,
                                mimeType: 'image/png',
                                width: video.videoWidth,
                                height: video.videoHeight,
                                prompt: effectivePrompt,
                                mediaType: 'video',
                                ...promptHistoryMeta,
                            });
                        }
                    } catch { /* 缂╃暐鍥惧け璐ヤ笉褰卞搷涓绘祦绋?*/ }

                    setIsLoading(false);
                };
                video.onerror = () => { setError('Failed to load generated keyframe video.'); setIsLoading(false); };
                video.src = videoUrl;
            } catch (err) {
                const error = err as Error;
                setError(`首尾帧动画生成失败: ${error.message}`);
                reportRuntimeIssue('首尾帧动画生成失败', error.stack || error.message);
                console.error('Keyframe generation failed:', error);
                setIsLoading(false);
            }
            return;
        }

        if (generationMode === 'video') {
            try {
                if (videoProvider !== 'google') {
                    throw new Error('Current video generation only supports Google Veo models. Please configure a Google video API key in settings.');
                }
                const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
                const imageElement = selectedElements.find(el => el.type === 'image') as ImageElement | undefined;
                const attachmentImage = activeAttachments[0];

                // Collect @mentioned images as additional reference sources
                const mentionedImages = mentionedElementIds
                    .map(id => elements.find(el => el.id === id))
                    .filter((el): el is ImageElement => !!el && el.type === 'image');

                // Priority: selected element > first @mentioned image > first attachment
                const baseVideoReference = imageElement
                    ? { href: imageElement.href, mimeType: imageElement.mimeType }
                    : mentionedImages.length > 0
                        ? { href: mentionedImages[0].href, mimeType: mentionedImages[0].mimeType }
                        : attachmentImage
                            ? { href: attachmentImage.href, mimeType: attachmentImage.mimeType }
                            : undefined;
                
                if (selectedElementIds.length > 1 || (selectedElementIds.length === 1 && !imageElement)) {
                    setError('For video generation, please select a single image or no elements.');
                    setIsLoading(false);
                    return;
                }
                
                const { videoBlob, mimeType } = await generateVideo(
                    effectivePrompt, 
                    videoAspectRatio, 
                    (message) => setProgressMessage(message), 
                    baseVideoReference
                );

                setProgressMessage('Processing video...');
                const videoUrl = URL.createObjectURL(videoBlob);
                const video = document.createElement('video');
                
                video.onloadedmetadata = () => {
                    if (!svgRef.current) return;
                    
                    let newWidth = video.videoWidth;
                    let newHeight = video.videoHeight;
                    const MAX_DIM = 800;
                    if (newWidth > MAX_DIM || newHeight > MAX_DIM) {
                        const ratio = newWidth / newHeight;
                        if (ratio > 1) { // landscape
                            newWidth = MAX_DIM;
                            newHeight = MAX_DIM / ratio;
                        } else { // portrait or square
                            newHeight = MAX_DIM;
                            newWidth = MAX_DIM * ratio;
                        }
                    }

                    const svgBounds = svgRef.current.getBoundingClientRect();
                    const screenCenter = { x: svgBounds.left + svgBounds.width / 2, y: svgBounds.top + svgBounds.height / 2 };
                    const canvasPoint = getCanvasPoint(screenCenter.x, screenCenter.y);
                    const x = canvasPoint.x - (newWidth / 2);
                    const y = canvasPoint.y - (newHeight / 2);

                    const newVideoElement: VideoElement = {
                        id: generateId(), type: 'video', name: 'Generated Video',
                        x, y,
                        width: newWidth,
                        height: newHeight,
                        href: videoUrl,
                        mimeType,
                    };

                    commitAction(prev => [...prev, newVideoElement]);
                    setSelectedElementIds([newVideoElement.id]);

                    // 鎴彇瑙嗛绗竴甯т綔涓虹缉鐣ュ浘淇濆瓨鍒板巻鍙茶褰?
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(video, 0, 0);
                            const thumbnailUrl = canvas.toDataURL('image/png');
                            saveGenerationToHistory({
                                name: 'Generated Video',
                                dataUrl: thumbnailUrl,
                                mimeType: 'image/png',
                                width: video.videoWidth,
                                height: video.videoHeight,
                                prompt: effectivePrompt,
                                mediaType: 'video',
                                ...promptHistoryMeta,
                            });
                        }
                    } catch { /* 缂╃暐鍥惧け璐ヤ笉褰卞搷涓绘祦绋?*/ }

                    setIsLoading(false);
                };

                video.onerror = () => {
                    setError('Could not load generated video metadata.');
                    setIsLoading(false);
                };
                
                video.src = videoUrl;

            } catch (err) {
                 const error = err as Error; 
                 setError(`Video generation failed: ${error.message}`); 
                 console.error("Video generation failed:", error);
                 setIsLoading(false);
            }
            return;
        }


        // IMAGE GENERATION LOGIC
        try {
            // Collect @mention reference images (闁告瑯浜滆ぐ鍥炊閸撗冾暬缂侇偉顕ч崢鎾舵閻欏懐绀夐柟鐑樺浮濞呭骸顔忛幓鎺撹含 selection 濞戞搩鍘惧▓?
            const mentionedImageElements = mentionedElementIds
                .map(id => elements.find(el => el.id === id))
                .filter((el): el is ImageElement => !!el && el.type === 'image' && !selectedElementIds.includes(el.id));
            const canUseReferenceEditing = supportsReferenceEditing;
            const hasReferenceContext = selectedElementIds.length > 0
                || mentionedImageElements.length > 0
                || attachmentReferenceImages.length > 0
                || characterReferenceImages.length > 0;

            if (!canUseReferenceEditing && hasReferenceContext) {
                setProgressMessage('当前模型不支持参考图编辑，已自动切换为纯文本生成。');
            }

            const isEditing = canUseReferenceEditing && selectedElementIds.length > 0;
            const effectiveMentionedImageElements = canUseReferenceEditing ? mentionedImageElements : [];
            const effectiveAttachmentReferenceImages = canUseReferenceEditing ? attachmentReferenceImages : [];
            const effectiveCharacterReferenceImages = canUseReferenceEditing ? characterReferenceImages : [];

            if (isEditing) {
                const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
                const imageElements = selectedElements.filter(el => el.type === 'image') as ImageElement[];
                const maskPaths = selectedElements.filter(el => el.type === 'path' && el.strokeOpacity && el.strokeOpacity < 1) as PathElement[];

                // Inpainting logic: selection is ONLY one image and one or more mask paths
                if (imageElements.length === 1 && maskPaths.length > 0 && selectedElements.length === (1 + maskPaths.length)) {
                    const baseImage = imageElements[0];
                    const maskData = await rasterizeMask(maskPaths, baseImage);
                    const result = await editImage(
                        [{ href: baseImage.href, mimeType: baseImage.mimeType }],
                        effectivePrompt,
                        { href: maskData.href, mimeType: maskData.mimeType }
                    );
                    
                    if (result.newImageBase64 && result.newImageMimeType) {
                        const { newImageBase64, newImageMimeType } = result;

                        const img = new Image();
                        img.onload = () => {
                            const maskPathIds = new Set(maskPaths.map(p => p.id));
                            const nextDataUrl = `data:${newImageMimeType};base64,${newImageBase64}`;
                            commitAction(prev => 
                                prev.map(el => {
                                    if (el.id === baseImage.id && el.type === 'image') {
                                        return {
                                            ...el,
                                            href: nextDataUrl,
                                            width: img.width,
                                            height: img.height,
                                        };
                                    }
                                    return el;
                                }).filter(el => !maskPathIds.has(el.id))
                            );
                            setSelectedElementIds([baseImage.id]);
                            const historyPreview = buildHistoryThumbnailFromImage(img, newImageMimeType, nextDataUrl);
                            saveGenerationToHistory({
                                name: baseImage.name || 'Edited image',
                                dataUrl: historyPreview.dataUrl,
                                originalDataUrl: nextDataUrl,
                                mimeType: historyPreview.mimeType,
                                width: img.width,
                                height: img.height,
                                prompt: effectivePrompt,
                                ...promptHistoryMeta,
                            });
                        };
                        img.onerror = () => setError('Failed to load the generated image.');
                        img.src = `data:${newImageMimeType};base64,${newImageBase64}`;

                    } else {
                        setError(result.textResponse || 'Inpainting failed to produce an image.');
                    }
                    return; // End execution for inpainting path
                }
                
                // Regular edit/combine logic (append @mention refs at the end)
                const imagePromises = selectedElements.map(el => {
                    if (el.type === 'image') return Promise.resolve({ href: el.href, mimeType: el.mimeType });
                    if (el.type === 'video') return Promise.reject(new Error("Cannot use video elements in image generation."));
                    return rasterizeElement(el as Exclude<Element, ImageElement | VideoElement>);
                });
                const imagesToProcess = await Promise.all(imagePromises);

                // Append @mentioned reference images 鈥?鎸?prompt 涓嚭鐜伴『搴忔帓鍒?
                const { prompt: mentionPrompt, orderedMentionImages } = buildMentionAwarePrompt(effectivePrompt, effectiveMentionedImageElements);
                const referenceImages = [...imagesToProcess, ...orderedMentionImages, ...effectiveAttachmentReferenceImages, ...effectiveCharacterReferenceImages];
                const result = imageProvider === 'google'
                    ? await editImage(referenceImages, mentionPrompt)
                    : await generateImageWithProvider(
                        mentionPrompt,
                        modelPreference.imageModel,
                        preferredImageKey,
                        {
                            size: buildImageSizeByRatio(imageResolution, imageAspectRatio),
                            aspectRatio: imageAspectRatio,
                            resolution: imageResolution,
                            referenceImages,
                        }
                    );

                if ((result.newImageBase64 && result.newImageMimeType) || result.newImageUrl) {
                    const imageSrc = result.newImageUrl || `data:${result.newImageMimeType};base64,${result.newImageBase64}`;
                    const imageMimeType = result.newImageMimeType || 'image/jpeg';
                    
                    const img = new Image();
                    img.onload = () => {
                        const placedSize = getInitialDisplayImageSize(img.width, img.height);
                        let minX = Infinity, minY = Infinity, maxX = -Infinity;
                        selectedElements.forEach(el => {
                            const bounds = getElementBounds(el);
                            minX = Math.min(minX, bounds.x);
                            minY = Math.min(minY, bounds.y);
                            maxX = Math.max(maxX, bounds.x + bounds.width);
                        });
                        const x = maxX + 20;
                        const y = minY;
                        
                        const newImage: ImageElement = {
                            id: generateId(), type: 'image', x, y, name: imageOutputName,
                            width: placedSize.width, height: placedSize.height,
                            href: imageSrc, mimeType: imageMimeType,
                        };
                        commitAction(prev => [...prev, newImage]);
                        setSelectedElementIds([newImage.id]);
                        const historyPreview = buildHistoryThumbnailFromImage(img, imageMimeType, imageSrc);
                        saveGenerationToHistory({
                            name: newImage.name,
                            dataUrl: historyPreview.dataUrl,
                            originalDataUrl: imageSrc,
                            mimeType: historyPreview.mimeType,
                            width: newImage.width,
                            height: newImage.height,
                            prompt: effectivePrompt,
                            ...promptHistoryMeta,
                        });
                    };
                    img.onerror = () => setError('Failed to load the generated image.');
                    img.src = imageSrc;
                } else { 
                    setError(result.textResponse || 'Generation failed to produce an image.'); 
                }

            } else if (effectiveMentionedImageElements.length > 0) {
                // No canvas selection, but user @mentioned image elements 鈥?鎸?prompt 寮曠敤椤哄簭鎺掑垪
                setProgressMessage('Generating with reference images...');
                const { prompt: mentionPrompt2, orderedMentionImages: orderedRefs } = buildMentionAwarePrompt(effectivePrompt, effectiveMentionedImageElements);
                const referenceImages = [...orderedRefs, ...effectiveAttachmentReferenceImages, ...effectiveCharacterReferenceImages];
                const result = imageProvider === 'google'
                    ? await editImage(referenceImages, mentionPrompt2)
                    : await generateImageWithProvider(
                        mentionPrompt2,
                        modelPreference.imageModel,
                        preferredImageKey,
                        {
                            size: buildImageSizeByRatio(imageResolution, imageAspectRatio),
                            aspectRatio: imageAspectRatio,
                            resolution: imageResolution,
                            referenceImages,
                        }
                    );

                if (result.newImageBase64 && result.newImageMimeType) {
                    const { newImageBase64, newImageMimeType } = result;
                    const img = new Image();
                    img.onload = () => {
                        if (!svgRef.current) return;
                        const placedSize = getInitialDisplayImageSize(img.width, img.height);
                        const svgBounds = svgRef.current.getBoundingClientRect();
                        const screenCenter = { x: svgBounds.left + svgBounds.width / 2, y: svgBounds.top + svgBounds.height / 2 };
                        const canvasPoint = getCanvasPoint(screenCenter.x, screenCenter.y);
                        const x = canvasPoint.x - (placedSize.width / 2);
                        const y = canvasPoint.y - (placedSize.height / 2);
                        const newImage: ImageElement = {
                            id: generateId(), type: 'image', x, y, name: imageOutputName,
                            width: placedSize.width, height: placedSize.height,
                            href: `data:${newImageMimeType};base64,${newImageBase64}`, mimeType: newImageMimeType,
                        };
                        commitAction(prev => [...prev, newImage]);
                        setSelectedElementIds([newImage.id]);
                        const historyPreview = buildHistoryThumbnailFromImage(
                            img,
                            newImageMimeType,
                            `data:${newImageMimeType};base64,${newImageBase64}`
                        );
                        saveGenerationToHistory({
                            name: newImage.name,
                            dataUrl: historyPreview.dataUrl,
                            originalDataUrl: `data:${newImageMimeType};base64,${newImageBase64}`,
                            mimeType: historyPreview.mimeType,
                            width: newImage.width,
                            height: newImage.height,
                            prompt: effectivePrompt,
                            ...promptHistoryMeta,
                        });
                    };
                    img.onerror = () => setError('Failed to load the generated image.');
                    img.src = `data:${newImageMimeType};base64,${newImageBase64}`;
                } else {
                    setError(result.textResponse || 'Generation failed to produce an image.');
                }

            } else {
                // Generate from scratch
                const baseRefs = [...effectiveAttachmentReferenceImages, ...effectiveCharacterReferenceImages];
                const requestedImageSize = buildImageSizeByRatio(imageResolution, imageAspectRatio);
                const result = baseRefs.length > 0
                    ? imageProvider === 'google'
                        ? await editImage(baseRefs, effectivePrompt)
                        : await generateImageWithProvider(
                            effectivePrompt,
                            modelPreference.imageModel,
                            preferredImageKey,
                            {
                                size: requestedImageSize,
                                aspectRatio: imageAspectRatio,
                                resolution: imageResolution,
                                referenceImages: baseRefs,
                            }
                        )
                    : await generateImageWithProvider(
                        effectivePrompt,
                        modelPreference.imageModel,
                        preferredImageKey,
                        {
                            size: requestedImageSize,
                            aspectRatio: imageAspectRatio,
                            resolution: imageResolution,
                        }
                    );

                if ((result.newImageBase64 && result.newImageMimeType) || result.newImageUrl) {
                    const imageSrc = result.newImageUrl || `data:${result.newImageMimeType};base64,${result.newImageBase64}`;
                    const imageMimeType = result.newImageMimeType || 'image/jpeg';

                    const img = new Image();
                    img.onload = () => {
                        if (!svgRef.current) return;
                        const placedSize = getInitialDisplayImageSize(img.width, img.height);
                        const svgBounds = svgRef.current.getBoundingClientRect();
                        const screenCenter = { x: svgBounds.left + svgBounds.width / 2, y: svgBounds.top + svgBounds.height / 2 };
                        const canvasPoint = getCanvasPoint(screenCenter.x, screenCenter.y);
                        const x = canvasPoint.x - (placedSize.width / 2);
                        const y = canvasPoint.y - (placedSize.height / 2);

                        const newImage: ImageElement = {
                            id: generateId(), type: 'image', x, y, name: imageOutputName,
                            width: placedSize.width, height: placedSize.height,
                            href: imageSrc, mimeType: imageMimeType,
                        };
                        commitAction(prev => [...prev, newImage]);
                        setSelectedElementIds([newImage.id]);
                        const historyPreview = buildHistoryThumbnailFromImage(img, imageMimeType, imageSrc);
                        saveGenerationToHistory({
                            name: newImage.name,
                            dataUrl: historyPreview.dataUrl,
                            originalDataUrl: imageSrc,
                            mimeType: historyPreview.mimeType,
                            width: newImage.width,
                            height: newImage.height,
                            prompt: effectivePrompt,
                            ...promptHistoryMeta,
                        });
                    };
                    img.onerror = () => setError('Failed to load the generated image.');
                    img.src = imageSrc;
                } else {
                    setError(result.textResponse || 'Generation failed to produce an image.');
                }
            }
        } catch (err) {
            const error = err as Error; 
            let friendlyMessage = `生成出错: ${error.message}`;

            if (error.message && (error.message.includes('API_KEY_INVALID') || error.message.includes('API key not valid'))) {
                friendlyMessage = 'Invalid API key. Please check and re-add your API key in Settings.';
            } else if (error.message && (error.message.includes('429') || error.message.toUpperCase().includes('RESOURCE_EXHAUSTED'))) {
                friendlyMessage = 'API quota exceeded. Please check your provider plan or try again later.';
            } else if (error.message && (error.message.includes('not configured') || error.message.includes('not set'))) {
                friendlyMessage = 'API key is missing. Please add your API key in Settings -> API config.';
            }

            setError(friendlyMessage); 
            console.error("Generation failed:", error);
            reportRuntimeIssue('生成失败', error.stack || error.message);
        } finally { 
            setIsLoading(false); 
        }
    };

    const handleRunNodeWorkflow = async (opts: { autoEnhance: boolean; enhanceMode: PromptEnhanceMode; stylePreset?: string }) => {
        let finalPrompt = prompt;
        if (opts.autoEnhance && prompt.trim()) {
            const enhanced = await handleEnhancePrompt({
                prompt,
                mode: opts.enhanceMode,
                stylePreset: opts.stylePreset,
            });
            if (enhanced.enhancedPrompt?.trim()) {
                finalPrompt = enhanced.enhancedPrompt.trim();
                setPrompt(finalPrompt);
            }
        }
        await handleGenerate(finalPrompt);
    };

    const handleCanvasImageDragStart = useCallback((image: ImageElement, e: React.DragEvent<SVGGElement>) => {
        const payload = {
            id: image.id,
            name: image.name,
            href: image.href,
            mimeType: image.mimeType,
        };
        e.dataTransfer.setData('application/x-canvas-image', JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', image.name || image.id);
        e.dataTransfer.effectAllowed = 'copy';
    }, []);
    
    const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);
    const handleDrop = useCallback((e: React.DragEvent) => { 
        e.preventDefault(); 
        if (handleAssetDropRef.current && handleAssetDropRef.current(e)) return;
        if (e.dataTransfer.files && e.dataTransfer.files[0]) { handleAddImageElement(e.dataTransfer.files[0]); }
    }, [handleAddImageElement]);

    const handlePropertyChange = (elementId: string, updates: Partial<Element>) => {
        commitAction(prev => prev.map(el => {
            if (el.id === elementId) {
                 return { ...el, ...updates };
            }
            return el;
        }));
    };

     const handleLayerAction = (elementId: string, action: 'front' | 'back' | 'forward' | 'backward') => {
        commitAction(prev => {
            const elementsCopy = [...prev];
            const index = elementsCopy.findIndex(el => el.id === elementId);
            if (index === -1) return elementsCopy;

            const [element] = elementsCopy.splice(index, 1);

            if (action === 'front') {
                elementsCopy.push(element);
            } else if (action === 'back') {
                elementsCopy.unshift(element);
            } else if (action === 'forward') {
                const newIndex = Math.min(elementsCopy.length, index + 1);
                elementsCopy.splice(newIndex, 0, element);
            } else if (action === 'backward') {
                const newIndex = Math.max(0, index - 1);
                elementsCopy.splice(newIndex, 0, element);
            }
            return elementsCopy;
        });
        setContextMenu(null);
    };
    
    const handleRasterizeSelection = async () => {
        const elementsToRasterize = elements.filter(
            el => selectedElementIds.includes(el.id) && el.type !== 'image' && el.type !== 'video'
        ) as Exclude<Element, ImageElement | VideoElement>[];

        if (elementsToRasterize.length === 0) return;

        setContextMenu(null);
        setIsLoading(true);
        setError(null);

        try {
            let minX = Infinity, minY = Infinity;
            elementsToRasterize.forEach(element => {
                const bounds = getElementBounds(element);
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
            });
            
            const { href, mimeType, width, height } = await rasterizeElements(elementsToRasterize);
            
            const newImage: ImageElement = {
                id: generateId(),
                type: 'image', name: 'Rasterized Image',
                x: minX - 10, // Account for padding used during rasterization
                y: minY - 10, // Account for padding
                width,
                height,
                href,
                mimeType
            };

            const idsToRemove = new Set(elementsToRasterize.map(el => el.id));

            commitAction(prev => {
                const remainingElements = prev.filter(el => !idsToRemove.has(el.id));
                return [...remainingElements, newImage];
            });

            setSelectedElementIds([newImage.id]);

        } catch (err) {
            const error = err as Error;
            setError(`Failed to rasterize selection: ${error.message}`);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGroup = () => {
        const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
        if (selectedElements.length < 2) return;
        
        const bounds = getSelectionBounds(selectedElementIds);
        const newGroupId = generateId();

        const newGroup: GroupElement = {
            id: newGroupId,
            type: 'group',
            name: 'Group',
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        };

        commitAction(prev => {
            const updatedElements = prev.map(el => 
                selectedElementIds.includes(el.id) ? { ...el, parentId: newGroupId } : el
            );
            return [...updatedElements, newGroup];
        });

        setSelectedElementIds([newGroupId]);
        setContextMenu(null);
    };

    const handleUngroup = () => {
        if (selectedElementIds.length !== 1) return;
        const groupId = selectedElementIds[0];
        const group = elements.find(el => el.id === groupId);
        if (!group || group.type !== 'group') return;

        const childrenIds: string[] = [];
        commitAction(prev => {
            return prev.map(el => {
                if (el.parentId === groupId) {
                    childrenIds.push(el.id);
                    return { ...el, parentId: undefined };
                }
                return el;
            }).filter(el => el.id !== groupId);
        });

        setSelectedElementIds(childrenIds);
        setContextMenu(null);
    };


    const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
        e.preventDefault();
        setContextMenu(null);
        const target = e.target as SVGElement;
        const elementId = target.closest('[data-id]')?.getAttribute('data-id');
        setContextMenu({ x: e.clientX, y: e.clientY, elementId: elementId || null });
    };


    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => { if (e.clipboardData?.files[0]?.type.startsWith("image/")) { e.preventDefault(); handleAddImageElement(e.clipboardData.files[0]); } };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [handleAddImageElement]);

    const getSelectionBounds = useCallback((selectionIds: string[]): Rect => {
        const selectedElements = elementsRef.current.filter(el => selectionIds.includes(el.id));
        if (selectedElements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectedElements.forEach(el => {
            const bounds = getElementBounds(el, elementsRef.current);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, []);

    const handleAlignSelection = (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
        const selectedElements = elementsRef.current.filter(el => selectedElementIds.includes(el.id));
        if (selectedElements.length < 2) return;
    
        const selectionBounds = getSelectionBounds(selectedElementIds);
        const { x: minX, y: minY, width, height } = selectionBounds;
        const maxX = minX + width;
        const maxY = minY + height;
    
        const selectionCenterX = minX + width / 2;
        const selectionCenterY = minY + height / 2;
    
        commitAction(prev => {
            const elementsToUpdate = new Map<string, { dx: number; dy: number }>();

            selectedElements.forEach(el => {
                const bounds = getElementBounds(el, prev);
                let dx = 0;
                let dy = 0;
        
                switch (alignment) {
                    case 'left':   dx = minX - bounds.x; break;
                    case 'center': dx = selectionCenterX - (bounds.x + bounds.width / 2); break;
                    case 'right':  dx = maxX - (bounds.x + bounds.width); break;
                    case 'top':    dy = minY - bounds.y; break;
                    case 'middle': dy = selectionCenterY - (bounds.y + bounds.height / 2); break;
                    case 'bottom': dy = maxY - (bounds.y + bounds.height); break;
                }
        
                if (dx !== 0 || dy !== 0) {
                    const elementsToMove = [el, ...getDescendants(el.id, prev)];
                    elementsToMove.forEach(elementToMove => {
                        if (!elementsToUpdate.has(elementToMove.id)) {
                            elementsToUpdate.set(elementToMove.id, { dx, dy });
                        }
                    });
                }
            });
            return prev.map((el): Element => {
                const delta = elementsToUpdate.get(el.id);
                if (!delta) {
                    return el;
                }

                const { dx, dy } = delta;
                
                switch (el.type) {
                    case 'image':
                    case 'shape':
                    case 'text':
                    case 'group':
                    case 'video':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'arrow':
                    case 'line':
                        return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) as [Point, Point] };
                    case 'path':
                        return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                }
            });
        });
    };

    const isElementVisible = useCallback((element: Element, allElements: Element[]): boolean => {
        if (element.isVisible === false) return false;
        if (element.parentId) {
            const parent = allElements.find(el => el.id === element.parentId);
            if (parent) {
                return isElementVisible(parent, allElements);
            }
        }
        return true;
    }, []);


    const isSelectionActive = selectedElementIds.length > 0;
    const singleSelectedElement = selectedElementIds.length === 1 ? elements.find(el => el.id === selectedElementIds[0]) : null;

    let cursor = 'default';
    if (croppingState) cursor = 'default';
    else if (interactionMode.current === 'pan') cursor = 'grabbing';
    else if (activeTool === 'pan') cursor = 'grab';
    else if (['draw', 'erase', 'rectangle', 'circle', 'triangle', 'arrow', 'line', 'text', 'highlighter', 'lasso'].includes(activeTool)) cursor = 'crosshair';

    // Board Management
    const handleAddBoard = () => {
        const newBoard = createNewBoard(`Board ${boards.length + 1}`);
        setBoards(prev => [...prev, newBoard]);
        setActiveBoardId(newBoard.id);
    };

    const handleDuplicateBoard = (boardId: string) => {
        const boardToDuplicate = boards.find(b => b.id === boardId);
        if (!boardToDuplicate) return;
        const newBoard = {
            ...boardToDuplicate,
            id: generateId(),
            name: `${boardToDuplicate.name} Copy`,
            history: [boardToDuplicate.elements],
            historyIndex: 0,
        };
        setBoards(prev => [...prev, newBoard]);
        setActiveBoardId(newBoard.id);
    };
    
    const handleDeleteBoard = (boardId: string) => {
        if (boards.length <= 1) return; // Can't delete the last board
        const nextBoards = boards.filter(board => board.id !== boardId);
        setBoards(nextBoards);
        if (activeBoardId === boardId && nextBoards.length > 0) {
            setActiveBoardId(nextBoards[0].id);
        }
    };
    
    const handleRenameBoard = (boardId: string, name: string) => {
        setBoards(prev => prev.map(b => b.id === boardId ? { ...b, name } : b));
    };

    const generateBoardThumbnail = useCallback((elements: Element[], bgColor: string): string => {
         const THUMB_WIDTH = 120;
         const THUMB_HEIGHT = 80;

        const recentImage = [...elements]
            .reverse()
            .find((el): el is ImageElement => el.type === 'image' && typeof el.href === 'string' && el.href.length > 0);
        if (recentImage) {
            return recentImage.href;
        }

        if (elements.length === 0) {
            const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /></svg>`;
            return `data:image/svg+xml;base64,${btoa(emptySvg)}`;
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elements.forEach(el => {
            const bounds = getElementBounds(el, elements);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        if (contentWidth <= 0 || contentHeight <= 0) {
            const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /></svg>`;
            return `data:image/svg+xml;base64,${btoa(emptySvg)}`;
        }

        const scale = Math.min(THUMB_WIDTH / contentWidth, THUMB_HEIGHT / contentHeight) * 0.9;
        const dx = (THUMB_WIDTH - contentWidth * scale) / 2 - minX * scale;
        const dy = (THUMB_HEIGHT - contentHeight * scale) / 2 - minY * scale;

        const svgContent = elements.map(el => {
             if (el.type === 'path') {
                const pathData = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                return `<path d="${pathData}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${el.strokeOpacity || 1}" />`;
             }
             if (el.type === 'image') {
                 return `<image href="${escapeXmlAttr(el.href)}" x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" />`;
             }
             // Add other element types for more accurate thumbnails if needed
             return '';
        }).join('');

        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /><g transform="translate(${dx} ${dy}) scale(${scale})">${svgContent}</g></svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fullSvg)))}`;
    }, []);

    return (
        <div className="theme-aware w-screen h-screen flex flex-col font-sans" style={{ backgroundColor: themePalette.appBackground }} onDragOver={handleDragOver} onDrop={handleDrop}>
            {isLoading && <Loader progressMessage={progressMessage} />}
            {error && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md shadow-lg flex items-center max-w-lg">
                    <span className="flex-grow">{error}</span>
                    <button onClick={() => setError(null)} className="ml-4 p-1 rounded-full hover:bg-red-200" title={t('common.close')} aria-label={t('common.close')}>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
                    </button>
                </div>
            )}
            {runtimeIssue && (
                <div className="fixed bottom-4 right-4 z-[130] w-[min(560px,92vw)] rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 shadow-2xl">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">Runtime Error Captured</div>
                            <div className="mt-0.5 text-xs break-words">{runtimeIssue.title}</div>
                            {runtimeIssue.detail && (
                                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-amber-100/70 p-2 text-[11px] leading-4">
{runtimeIssue.detail}
                                </pre>
                            )}
                        </div>
                        <button
                            type="button"
                            className="rounded-md px-2 py-1 text-xs font-medium hover:bg-amber-200"
                            onClick={() => setRuntimeIssue(null)}
                        >
                            关闭
                        </button>
                    </div>
                </div>
            )}
            <WorkspaceSidebar
                isOpen={!isLayerMinimized}
                onToggle={() => setIsLayerMinimized(prev => !prev)}
                outerGap={chromeMetrics.outerGap}
                panelWidth={chromeMetrics.sidebarWidth}
                boards={boards}
                activeBoardId={activeBoardId}
                onSwitchBoard={setActiveBoardId}
                onAddBoard={handleAddBoard}
                onRenameBoard={handleRenameBoard}
                onDuplicateBoard={handleDuplicateBoard}
                onDeleteBoard={handleDeleteBoard}
                generateBoardThumbnail={(els) => generateBoardThumbnail(els, canvasBackgroundColor)}
                elements={elements}
                selectedElementIds={selectedElementIds}
                onSelectElement={id => setSelectedElementIds(id ? [id] : [])}
                onToggleVisibility={id => handlePropertyChange(id, { isVisible: !(elements.find(el => el.id === id)?.isVisible ?? true) })}
                onToggleLock={id => handlePropertyChange(id, { isLocked: !(elements.find(el => el.id === id)?.isLocked ?? false) })}
                onRenameElement={(id, name) => handlePropertyChange(id, { name })}
                onReorder={(draggedId, targetId, position) => {
                    commitAction(prev => {
                        const newElements = [...prev];
                        const draggedIndex = newElements.findIndex(el => el.id === draggedId);
                        if (draggedIndex === -1) return prev;

                        const [draggedItem] = newElements.splice(draggedIndex, 1);
                        const targetIndex = newElements.findIndex(el => el.id === targetId);
                        if (targetIndex === -1) {
                            newElements.push(draggedItem);
                            return newElements;
                        }

                        const finalIndex = position === 'before' ? targetIndex : targetIndex + 1;
                        newElements.splice(finalIndex, 0, draggedItem);
                        return newElements;
                    });
                }}
            />
            {/* New Right Panel (multi-function: generate + inspiration) */}
            <RightPanel
                theme={resolvedTheme}
                isMinimized={isInspirationMinimized}
                onToggleMinimize={() => setIsInspirationMinimized(prev => !prev)}
                outerGap={chromeMetrics.outerGap}
                defaultWidth={chromeMetrics.rightPanelDefaultWidth}
                minWidth={chromeMetrics.rightPanelMinWidth}
                widthCap={chromeMetrics.rightPanelWidthCap}
                compactMode={chromeMetrics.isTablet}
                library={assetLibrary}
                generationHistory={generationHistory}
                attachments={chatAttachments}
                onRemove={(cat, id) => setAssetLibrary(prev => removeAsset(prev, cat, id))}
                onRename={(cat, id, name) => setAssetLibrary(prev => renameAsset(prev, cat, id, name))}
                onGenerate={(nextPrompt) => {
                    setPrompt(nextPrompt);
                    handleGenerate(nextPrompt, 'right');
                }}
                onAddAttachments={handleAddAttachmentFiles}
                onRemoveAttachment={handleRemoveChatAttachment}
                onWidthChange={setRightPanelWidth}
            />
            <CanvasSettings 
                isOpen={isSettingsPanelOpen} 
                onClose={() => setIsSettingsPanelOpen(false)} 
                language={language}
                setLanguage={setLanguage}
                themeMode={themeMode}
                resolvedTheme={resolvedTheme}
                setThemeMode={setThemeMode}
                wheelAction={wheelAction}
                setWheelAction={setWheelAction}
                userApiKeys={userApiKeys}
                onAddApiKey={handleAddApiKey}
                onDeleteApiKey={handleDeleteApiKey}
                onUpdateApiKey={handleUpdateApiKey}
                onSetDefaultApiKey={handleSetDefaultApiKey}
                modelPreference={modelPreference}
                setModelPreference={setModelPreference}
                t={t}
                apiConfigStore={apiConfigStore}
                clearKeysOnExit={clearKeysOnExit}
                setClearKeysOnExit={setClearKeysOnExit}
            />
            {/* 鏂扮敤鎴峰紩瀵煎脊绐?鈥?鏃?API Key 鏃惰嚜鍔ㄥ嚭鐜?*/}
            <OnboardingWizard
                isOpen={showOnboarding}
                onClose={() => {
                    setShowOnboarding(false);
                    safeLocalStorageSetItem('onboarding.skipped', 'true');
                }}
                onAddApiKey={handleAddApiKey}
                resolvedTheme={resolvedTheme}
            />
            <Toolbar
                t={t}
                theme={resolvedTheme}
                compactScale={chromeMetrics.toolbarScale}
                topOffset={chromeMetrics.outerGap}
                leftClosed={chromeMetrics.toolbarLeftClosed}
                leftOpen={chromeMetrics.toolbarLeftOpen}
                activeTool={activeTool}
                setActiveTool={setActiveTool}
                drawingOptions={drawingOptions}
                setDrawingOptions={setDrawingOptions}
                onUpload={handleAddImageElement}
                isCropping={!!croppingState}
                onConfirmCrop={handleConfirmCrop}
                onCancelCrop={handleCancelCrop}
                onSettingsClick={() => setIsSettingsPanelOpen(true)}
                onLayersClick={() => setIsLayerMinimized(prev => !prev)}
                onBoardsClick={() => setIsLayerMinimized(prev => !prev)}
                onAssetsClick={() => setIsInspirationMinimized(prev => !prev)}
                onUndo={handleUndo}
                onRedo={handleRedo}
                isLayerPanelExpanded={!isLayerMinimized}
                onHeightChange={() => { /* reserved for aligning external buttons under toolbar */ }}
                onLeftChange={(left) => setToolbarLeft(left)}
                canUndo={historyIndex > 0}
                canRedo={historyIndex < history.length - 1}
            />
            {addAssetModal?.open && (
                <AssetAddModal 
                    isOpen={addAssetModal.open}
                    onClose={() => setAddAssetModal(null)}
                    previewDataUrl={addAssetModal.dataUrl}
                    onConfirm={(category, name) => {
                        const newItem: AssetItem = {
                            id: generateId(),
                            name,
                            category,
                            dataUrl: addAssetModal.dataUrl,
                            mimeType: addAssetModal.mimeType,
                            width: addAssetModal.width,
                            height: addAssetModal.height,
                            createdAt: Date.now(),
                        };
                        setAssetLibrary(prev => addAsset(prev, newItem));
                        setAddAssetModal(null);
                    }}
                />
            )}
            <div 
                className="compact-canvas-stage flex-grow relative overflow-hidden"
                style={{
                    paddingRight: chromeMetrics.isTablet ? `${chromeMetrics.outerGap}px` : `${rightPanelWidth + chromeMetrics.promptSideInset}px`,
                    paddingBottom: croppingState ? '0px' : `${chromeMetrics.canvasBottomInset}px`,
                    transition: 'padding-right 0.35s cubic-bezier(0.4, 0, 0.2, 1), padding-bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
            >
                <svg
                    ref={svgRef}
                    className="w-full h-full"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onWheel={handleWheel}
                    onContextMenu={handleContextMenu}
                    style={{ cursor }}
                >
                    <defs>
                         {elements.map(el => {
                            if (el.type === 'image' && el.borderRadius && el.borderRadius > 0) {
                                const clipPathId = `clip-${el.id}`;
                                return (
                                    <clipPath id={clipPathId} key={clipPathId}>
                                        <rect
                                            width={el.width}
                                            height={el.height}
                                            rx={el.borderRadius}
                                            ry={el.borderRadius}
                                        />
                                    </clipPath>
                                );
                            }
                            return null;
                        })}
                    </defs>
                    <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoom})`}>
                        {elements.map(el => {
                            if (!isElementVisible(el, elements)) return null;

                            const isSelected = selectedElementIds.includes(el.id);
                            let selectionComponent = null;

                            if (isSelected && !croppingState) {
                                if (selectedElementIds.length > 1 || el.type === 'path' || el.type === 'arrow' || el.type === 'line' || el.type === 'group') {
                                     const bounds = getElementBounds(el, elements);
                                     selectionComponent = <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" stroke="rgb(59 130 246)" strokeWidth={2/zoom} strokeDasharray={`${6/zoom} ${4/zoom}`} pointerEvents="none" />
                                } else if ((el.type === 'image' || el.type === 'shape' || el.type === 'text' || el.type === 'video')) {
                                    const handleSize = 8 / zoom;
                                    const handles = [
                                        { name: 'tl', x: el.x, y: el.y, cursor: 'nwse-resize' }, { name: 'tm', x: el.x + el.width / 2, y: el.y, cursor: 'ns-resize' }, { name: 'tr', x: el.x + el.width, y: el.y, cursor: 'nesw-resize' },
                                        { name: 'ml', x: el.x, y: el.y + el.height / 2, cursor: 'ew-resize' }, { name: 'mr', x: el.x + el.width, y: el.y + el.height / 2, cursor: 'ew-resize' },
                                        { name: 'bl', x: el.x, y: el.y + el.height, cursor: 'nesw-resize' }, { name: 'bm', x: el.x + el.width / 2, y: el.y + el.height, cursor: 'ns-resize' }, { name: 'br', x: el.x + el.width, y: el.y + el.height, cursor: 'nwse-resize' },
                                    ];
                                     selectionComponent = <g>
                                        <rect x={el.x} y={el.y} width={el.width} height={el.height} fill="none" stroke="rgb(59 130 246)" strokeWidth={2 / zoom} pointerEvents="none" />
                                        {handles.map(h => <rect key={h.name} data-handle={h.name} x={h.x - handleSize / 2} y={h.y - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="#3b82f6" strokeWidth={1 / zoom} style={{ cursor: h.cursor }} />)}
                                    </g>;
                                }
                            }
                           
                            if (el.type === 'path') {
                                const pathData = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                                return <g key={el.id} data-id={el.id} className="cursor-pointer"><path d={pathData} stroke={el.strokeColor} strokeWidth={el.strokeWidth / zoom} fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" strokeOpacity={el.strokeOpacity} />{selectionComponent}</g>;
                            }
                            if (el.type === 'arrow') {
                                const [start, end] = el.points;
                                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                                const headLength = el.strokeWidth * 4;

                                const arrowHeadHeight = headLength * Math.cos(Math.PI / 6);
                                const lineEnd = {
                                    x: end.x - arrowHeadHeight * Math.cos(angle),
                                    y: end.y - arrowHeadHeight * Math.sin(angle),
                                };

                                const headPoint1 = { x: end.x - headLength * Math.cos(angle - Math.PI / 6), y: end.y - headLength * Math.sin(angle - Math.PI / 6) };
                                const headPoint2 = { x: end.x - headLength * Math.cos(angle + Math.PI / 6), y: end.y - headLength * Math.sin(angle + Math.PI / 6) };
                                return (
                                    <g key={el.id} data-id={el.id} className="cursor-pointer">
                                        <line x1={start.x} y1={start.y} x2={lineEnd.x} y2={lineEnd.y} stroke={el.strokeColor} strokeWidth={el.strokeWidth / zoom} strokeLinecap="round" />
                                        <polygon points={`${end.x},${end.y} ${headPoint1.x},${headPoint1.y} ${headPoint2.x},${headPoint2.y}`} fill={el.strokeColor} />
                                        {selectionComponent}
                                    </g>
                                );
                            }
                            if (el.type === 'line') {
                                const [start, end] = el.points;
                                return (
                                    <g key={el.id} data-id={el.id} className="cursor-pointer">
                                        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={el.strokeColor} strokeWidth={el.strokeWidth / zoom} strokeLinecap="round" />
                                        {selectionComponent}
                                    </g>
                                );
                            }
                            if (el.type === 'text') {
                                const isEditing = editingElement?.id === el.id;
                                return (
                                    <g key={el.id} data-id={el.id} transform={`translate(${el.x}, ${el.y})`} className="cursor-pointer">
                                        {!isEditing && (
                                            <foreignObject width={el.width} height={el.height} style={{ overflow: 'visible' }}>
                                                <div style={{ fontSize: el.fontSize, color: el.fontColor, width: '100%', height: '100%', wordBreak: 'break-word' }}>
                                                    {el.text}
                                                </div>
                                            </foreignObject>
                                        )}
                                        {selectionComponent && React.cloneElement(selectionComponent, { transform: `translate(${-el.x}, ${-el.y})` })}
                                    </g>
                                )
                            }
                             if (el.type === 'shape') {
                                let shapeJsx;
                                if (el.shapeType === 'rectangle') shapeJsx = <rect width={el.width} height={el.height} rx={el.borderRadius || 0} ry={el.borderRadius || 0} />
                                else if (el.shapeType === 'circle') shapeJsx = <ellipse cx={el.width/2} cy={el.height/2} rx={el.width/2} ry={el.height/2} />
                                else if (el.shapeType === 'triangle') shapeJsx = <polygon points={`${el.width/2},0 0,${el.height} ${el.width},${el.height}`} />
                                return (
                                     <g key={el.id} data-id={el.id} transform={`translate(${el.x}, ${el.y})`} className="cursor-pointer">
                                        {shapeJsx && React.cloneElement(shapeJsx, { 
                                            fill: el.fillColor, 
                                            stroke: el.strokeColor, 
                                            strokeWidth: el.strokeWidth / zoom,
                                            strokeDasharray: el.strokeDashArray ? el.strokeDashArray.join(' ') : 'none'
                                        })}
                                        {selectionComponent && React.cloneElement(selectionComponent, { transform: `translate(${-el.x}, ${-el.y})` })}
                                    </g>
                                );
                            }
                            if (el.type === 'image') {
                                const hasBorderRadius = el.borderRadius && el.borderRadius > 0;
                                const clipPathId = `clip-${el.id}`;
                                return (
                                    <g
                                        key={el.id}
                                        data-id={el.id}
                                    >
                                        <image 
                                            transform={`translate(${el.x}, ${el.y})`} 
                                            href={el.href} 
                                            width={el.width} 
                                            height={el.height} 
                                            className={croppingState && croppingState.elementId !== el.id ? 'opacity-30' : ''} 
                                            clipPath={hasBorderRadius ? `url(#${clipPathId})` : undefined}
                                        />
                                        {selectionComponent}
                                    </g>
                                );
                            }
                             if (el.type === 'video') {
                                return (
                                    <g key={el.id} data-id={el.id}>
                                        <foreignObject x={el.x} y={el.y} width={el.width} height={el.height}>
                                            <video 
                                                src={el.href} 
                                                controls 
                                                style={{ width: '100%', height: '100%', borderRadius: '8px' }}
                                                className={croppingState ? 'opacity-30' : ''}
                                            ></video>
                                        </foreignObject>
                                        {selectionComponent}
                                    </g>
                                );
                            }
                             if (el.type === 'group') {
                                return <g key={el.id} data-id={el.id}>{selectionComponent}</g>
                             }
                            return null;
                        })}

                        {lassoPath && (
                            <path d={lassoPath.map((p, i) => i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`).join(' ')} stroke="rgb(59 130 246)" strokeWidth={1 / zoom} strokeDasharray={`${4/zoom} ${4/zoom}`} fill="rgba(59, 130, 246, 0.1)" />
                        )}
                        
                        {alignmentGuides.map((guide, i) => (
                             <line key={i} x1={guide.type === 'v' ? guide.position : guide.start} y1={guide.type === 'h' ? guide.position : guide.start} x2={guide.type === 'v' ? guide.position : guide.end} y2={guide.type === 'h' ? guide.position : guide.end} stroke="red" strokeWidth={1/zoom} strokeDasharray={`${4/zoom} ${2/zoom}`} />
                        ))}

                        {selectedElementIds.length > 0 && !croppingState && !editingElement && (() => {
                            if (selectedElementIds.length > 1) {
                                const bounds = getSelectionBounds(selectedElementIds);
                                const toolbarScreenWidth = 280;
                                const toolbarScreenHeight = 56;
                                
                                const toolbarCanvasWidth = toolbarScreenWidth / zoom;
                                const toolbarCanvasHeight = toolbarScreenHeight / zoom;
                                
                                const x = bounds.x + bounds.width / 2 - (toolbarCanvasWidth / 2);
                                const y = bounds.y - toolbarCanvasHeight - (10 / zoom);

                                const toolbar = <div
                                    style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left', width: `${toolbarScreenWidth}px`, height: `${toolbarScreenHeight}px` }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <div className="p-1.5 bg-white rounded-lg shadow-lg flex items-center justify-start space-x-2 border border-gray-200 text-gray-800 overflow-x-auto">
                                        <button title={t('contextMenu.alignment.alignLeft')} onClick={() => handleAlignSelection('left')} className="p-2 rounded hover:bg-gray-100"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="3"></line><rect x="8" y="6" width="8" height="4" rx="1"></rect><rect x="8" y="14" width="12" height="4" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignCenter')} onClick={() => handleAlignSelection('center')} className="p-2 rounded hover:bg-gray-100"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="21" x2="12" y2="3" strokeDasharray="2 2"></line><rect x="7" y="6" width="10" height="4" rx="1"></rect><rect x="4" y="14" width="16" height="4" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignRight')} onClick={() => handleAlignSelection('right')} className="p-2 rounded hover:bg-gray-100"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="20" y1="21" x2="20" y2="3"></line><rect x="12" y="6" width="8" height="4" rx="1"></rect><rect x="8" y="14" width="12" height="4" rx="1"></rect></svg></button>
                                        <div className="h-6 w-px bg-gray-200"></div>
                                        <button title={t('contextMenu.alignment.alignTop')} onClick={() => handleAlignSelection('top')} className="p-2 rounded hover:bg-gray-100"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="4" x2="21" y2="4"></line><rect x="6" y="8" width="4" height="8" rx="1"></rect><rect x="14" y="8" width="4" height="12" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignMiddle')} onClick={() => handleAlignSelection('middle')} className="p-2 rounded hover:bg-gray-100"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2"></line><rect x="6" y="7" width="4" height="10" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignBottom')} onClick={() => handleAlignSelection('bottom')} className="p-2 rounded hover:bg-gray-100"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="20" x2="21" y2="20"></line><rect x="6" y="12" width="4" height="8" rx="1"></rect><rect x="14" y="8" width="4" height="12" rx="1"></rect></svg></button>
                                    </div>
                                </div>;
                                return (
                                    <foreignObject x={x} y={y} width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                                        {toolbar}
                                    </foreignObject>
                                );
                            } else if (singleSelectedElement) {
                                const element = singleSelectedElement;
                                const bounds = getElementBounds(element, elements);
                                let toolbarScreenWidth = 160;
                                if (element.type === 'shape') {
                                    toolbarScreenWidth = 300;
                                }
                                if (element.type === 'text') toolbarScreenWidth = 220;
                                if (element.type === 'arrow' || element.type === 'line') toolbarScreenWidth = 220;
                                if (element.type === 'image') toolbarScreenWidth = 500;
                                if (element.type === 'video') toolbarScreenWidth = 160;
                                if (element.type === 'group') toolbarScreenWidth = 80;

                                const toolbarScreenHeight = 56;
                                
                                const toolbarCanvasWidth = toolbarScreenWidth / zoom;
                                const toolbarCanvasHeight = toolbarScreenHeight / zoom;
                                
                                const x = bounds.x + bounds.width / 2 - (toolbarCanvasWidth / 2);
                                const y = bounds.y - toolbarCanvasHeight - (10 / zoom);
                                
                                const toolbar = <div
                                    style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left', width: `${toolbarScreenWidth}px`, height: `${toolbarScreenHeight}px` }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <div className="p-1.5 bg-white rounded-lg shadow-lg flex items-center justify-start space-x-2 border border-gray-200 text-gray-800 overflow-x-auto">
                                        <button title={t('contextMenu.copy')} onClick={() => handleCopyElement(element)} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                                        {element.type === 'image' && <button title={t('contextMenu.download')} onClick={() => handleDownloadImage(element)} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>}
                                        {element.type === 'image' && <button title="Add to asset library" onClick={async () => {
                                                const { href, mimeType, width, height } = { href: (element as ImageElement).href, mimeType: (element as ImageElement).mimeType, width: (element as ImageElement).width, height: (element as ImageElement).height };
                                                setAddAssetModal({ open: true, dataUrl: href, mimeType, width, height });
                                            }} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
                                            </button>}
                                        {element.type === 'image' && <button title="Split into layers with BANANA" onClick={() => handleSplitImageWithBanana(element)} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center disabled:opacity-50" disabled={isLoading}>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"></rect><rect x="13" y="3" width="8" height="8" rx="1"></rect><rect x="3" y="13" width="8" height="8" rx="1"></rect><path d="M13 17h8"></path><path d="M17 13v8"></path></svg>
                                            </button>}
                                        {element.type === 'image' && <button title="BANANA Agent: upscale x2" onClick={() => handleUpscaleImageWithBanana(element)} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center disabled:opacity-50" disabled={isLoading}>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                                            </button>}
                                        {element.type === 'image' && <button title="BANANA Agent: remove background" onClick={() => handleRemoveBackgroundWithBanana(element)} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center disabled:opacity-50" disabled={isLoading}>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"></path><path d="M20 12a8 8 0 0 1-11.31 7.31"></path><path d="M4 12a8 8 0 0 1 11.31-7.31"></path></svg>
                                            </button>}
                                        {element.type === 'video' && <a title={t('contextMenu.download')} href={element.href} download={`video-${element.id}.mp4`} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>}
                                        {element.type === 'image' && <button title={t('contextMenu.crop')} onClick={() => handleStartCrop(element)} className="p-2 rounded hover:bg-gray-100 flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg></button>}
                                        
                                        {element.type === 'shape' && (
                                            <>
                                                <input type="color" title={t('contextMenu.fillColor')} value={element.fillColor} onChange={e => handlePropertyChange(element.id, { fillColor: e.target.value })} className="w-7 h-7 p-0 border-none rounded cursor-pointer" />
                                                <div className="h-6 w-px bg-gray-200"></div>
                                                <input type="color" title={t('contextMenu.strokeColor')} value={element.strokeColor} onChange={e => handlePropertyChange(element.id, { strokeColor: e.target.value })} className="w-7 h-7 p-0 border-none rounded cursor-pointer" />
                                                <div className="h-6 w-px bg-gray-200"></div>
                                                <div title={t('contextMenu.strokeStyle')} className="flex items-center space-x-1 p-1 bg-gray-100 rounded-md">
                                                    <button title={t('contextMenu.solid')} onClick={() => handlePropertyChange(element.id, { strokeDashArray: undefined })} className={`p-1 rounded ${!element.strokeDashArray ? 'bg-blue-200' : 'hover:bg-gray-200'}`}>
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                                    </button>
                                                    <button title={t('contextMenu.dashed')} onClick={() => handlePropertyChange(element.id, { strokeDashArray: [10, 10] })} className={`p-1 rounded ${element.strokeDashArray?.toString() === '10,10' ? 'bg-blue-200' : 'hover:bg-gray-200'}`}>
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="9" y2="12"></line><line x1="15" y1="12" x2="19" y2="12"></line></svg>
                                                    </button>
                                                    <button title={t('contextMenu.dotted')} onClick={() => handlePropertyChange(element.id, { strokeDashArray: [2, 6] })} className={`p-1 rounded ${element.strokeDashArray?.toString() === '2,6' ? 'bg-blue-200' : 'hover:bg-gray-200'}`}>
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="5.01" y2="12"></line><line x1="12" y1="12" x2="12.01" y2="12"></line><line x1="19" y1="12" x2="19.01" y2="12"></line></svg>
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                         
                                        {element.type === 'text' && <input type="color" title={t('contextMenu.fontColor')} value={element.fontColor} onChange={e => handlePropertyChange(element.id, { fontColor: e.target.value })} className="w-7 h-7 p-0 border-none rounded cursor-pointer" />}
                                        {element.type === 'text' && <input type="number" title={t('contextMenu.fontSize')} value={element.fontSize} onChange={e => handlePropertyChange(element.id, { fontSize: parseInt(e.target.value, 10) || 16 })} className="w-16 p-1 border rounded bg-gray-100 text-gray-800" />}
                                        {(element.type === 'arrow' || element.type === 'line') && <input type="color" title={t('contextMenu.strokeColor')} value={element.strokeColor} onChange={e => handlePropertyChange(element.id, { strokeColor: e.target.value })} className="w-7 h-7 p-0 border-none rounded cursor-pointer" />}
                                        {(element.type === 'arrow' || element.type === 'line') && <input type="range" title={t('contextMenu.strokeWidth')} min="1" max="50" value={element.strokeWidth} onChange={e => handlePropertyChange(element.id, { strokeWidth: parseInt(e.target.value, 10) })} className="w-20" />}
                                        <div className="h-6 w-px bg-gray-200"></div>
                                        <button title={t('contextMenu.delete')} onClick={() => handleDeleteElement(element.id)} className="p-2 rounded hover:bg-red-100 hover:text-red-600 flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                                    </div>
                                </div>;
                                
                                return (
                                    <foreignObject x={x} y={y} width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                                        {toolbar}
                                    </foreignObject>
                                );
                            }
                            return null;
                        })()}
                        {editingElement && (() => {
                             const element = elements.find(el => el.id === editingElement.id) as TextElement;
                             if (!element) return null;
                             return <foreignObject 
                                x={element.x} y={element.y} width={element.width} height={element.height}
                                onMouseDown={(e) => e.stopPropagation()}
                             >
                                <textarea
                                    ref={editingTextareaRef}
                                    value={editingElement.text}
                                    onChange={(e) => setEditingElement({ ...editingElement, text: e.target.value })}
                                    onBlur={() => handleStopEditing()}
                                    placeholder={t('editor.editText')}
                                    title={t('editor.editText')}
                                    style={{
                                        width: '100%', height: '100%', border: 'none', padding: 0, margin: 0,
                                        outline: 'none', resize: 'none', background: 'transparent',
                                        fontSize: element.fontSize, color: element.fontColor,
                                        overflow: 'hidden'
                                    }}
                                 />
                             </foreignObject>
                        })()}
                        {croppingState && (
                             <g>
                                <path
                                    d={`M ${-panOffset.x/zoom},${-panOffset.y/zoom} H ${window.innerWidth/zoom - panOffset.x/zoom} V ${window.innerHeight/zoom - panOffset.y/zoom} H ${-panOffset.x/zoom} Z M ${croppingState.cropBox.x},${croppingState.cropBox.y} v ${croppingState.cropBox.height} h ${croppingState.cropBox.width} v ${-croppingState.cropBox.height} Z`}
                                    fill="rgba(0,0,0,0.5)"
                                    fillRule="evenodd"
                                    pointerEvents="none"
                                />
                                <rect x={croppingState.cropBox.x} y={croppingState.cropBox.y} width={croppingState.cropBox.width} height={croppingState.cropBox.height} fill="none" stroke="white" strokeWidth={2 / zoom} pointerEvents="all" />
                                {(() => {
                                    const { x, y, width, height } = croppingState.cropBox;
                                    const handleSize = 10 / zoom;
                                    const handles = [
                                        { name: 'tl', x, y, cursor: 'nwse-resize' }, { name: 'tr', x: x + width, y, cursor: 'nesw-resize' },
                                        { name: 'bl', x, y: y + height, cursor: 'nesw-resize' }, { name: 'br', x: x + width, y: y + height, cursor: 'nwse-resize' },
                                    ];
                                    return handles.map(h => <rect key={h.name} data-handle={h.name} x={h.x - handleSize/2} y={h.y - handleSize/2} width={handleSize} height={handleSize} fill="white" stroke="#3b82f6" strokeWidth={1/zoom} style={{ cursor: h.cursor }}/>)
                                })()}
                            </g>
                        )}
                        {selectionBox && (
                             <rect
                                x={selectionBox.x}
                                y={selectionBox.y}
                                width={selectionBox.width}
                                height={selectionBox.height}
                                fill="rgba(59, 130, 246, 0.1)"
                                stroke="rgb(59, 130, 246)"
                                strokeWidth={1 / zoom}
                            />
                        )}
                    </g>
                </svg>
                 {contextMenu && (() => {
                    const hasDrawableSelection = elements.some(el => selectedElementIds.includes(el.id) && el.type !== 'image' && el.type !== 'video');
                    const isGroupable = selectedElementIds.length > 1;
                    const isUngroupable = selectedElementIds.length === 1 && elements.find(el => el.id === selectedElementIds[0])?.type === 'group';

                    return (
                        <div style={{ top: contextMenu.y, left: contextMenu.x }} className="absolute z-30 bg-white rounded-md shadow-lg border border-gray-200 text-sm py-1 text-gray-800" onContextMenu={e => e.stopPropagation()}>
                           {isGroupable && <button onClick={handleGroup} className="block w-full text-left px-4 py-1.5 hover:bg-gray-100">{t('contextMenu.group')}</button>}
                           {isUngroupable && <button onClick={handleUngroup} className="block w-full text-left px-4 py-1.5 hover:bg-gray-100">{t('contextMenu.ungroup')}</button>}
                           {(isGroupable || isUngroupable) && <div className="border-t border-gray-100 my-1"></div>}
                            
                            {contextMenu.elementId && (<>
                                <button onClick={() => handleLayerAction(contextMenu.elementId!, 'forward')} className="block w-full text-left px-4 py-1.5 hover:bg-gray-100">{t('contextMenu.bringForward')}</button>
                                <button onClick={() => handleLayerAction(contextMenu.elementId!, 'backward')} className="block w-full text-left px-4 py-1.5 hover:bg-gray-100">{t('contextMenu.sendBackward')}</button>
                                <div className="border-t border-gray-100 my-1"></div>
                                <button onClick={() => handleLayerAction(contextMenu.elementId!, 'front')} className="block w-full text-left px-4 py-1.5 hover:bg-gray-100">{t('contextMenu.bringToFront')}</button>
                                <button onClick={() => handleLayerAction(contextMenu.elementId!, 'back')} className="block w-full text-left px-4 py-1.5 hover:bg-gray-100">{t('contextMenu.sendToBack')}</button>
                            </>)}
                            
                            {hasDrawableSelection && (
                                <>
                                    <div className="border-t border-gray-100 my-1"></div>
                                    <button onClick={handleRasterizeSelection} className="block w-full text-left px-4 py-1.5 hover:bg-gray-100">{t('contextMenu.rasterize')}</button>
                                </>
                            )}
                        </div>
                    );
                })()}
            </div>
            <div 
                className="compact-prompt-dock fixed bottom-0 left-0 right-0 z-[80] transition-all duration-300 ease-out flex justify-center pointer-events-none"
                style={{
                    paddingLeft: chromeMetrics.isTablet ? `${chromeMetrics.promptSideInset}px` : `${isLayerMinimized ? chromeMetrics.outerGap : chromeMetrics.sidebarWidth + chromeMetrics.outerGap + 8}px`,
                    paddingRight: chromeMetrics.isTablet ? `${chromeMetrics.promptSideInset}px` : `${rightPanelWidth + chromeMetrics.promptSideInset}px`,
                    paddingBottom: `${chromeMetrics.promptDockBottom}px`
                }}
            >
                <div className="compact-prompt-dock__inner pointer-events-auto w-full transition-transform hover:-translate-y-0.5 duration-300 drop-shadow-xl" style={{ maxWidth: `${chromeMetrics.promptMaxWidth}px` }}>
                    <PromptBar 
                            t={t}
                            theme={resolvedTheme}
                            compactMode={chromeMetrics.isTablet}
                            prompt={prompt} 
                            setPrompt={setPrompt} 
                            onGenerate={(nextPrompt) => handleGenerate(nextPrompt, 'prompt')} 
                            isLoading={isLoading} 
                            isSelectionActive={isSelectionActive} 
                            selectedElementCount={selectedElementIds.length}
                            onAddUserEffect={handleAddUserEffect}
                            userEffects={userEffects}
                            onDeleteUserEffect={handleDeleteUserEffect}
                            generationMode={generationMode}
                            setGenerationMode={setGenerationMode}
                            videoAspectRatio={videoAspectRatio}
                            setVideoAspectRatio={setVideoAspectRatio}
                            imageResolution={imageResolution}
                            imageResolutionOptions={[...IMAGE_RESOLUTION_OPTIONS]}
                            setImageResolution={setImageResolution}
                            imageAspectRatio={imageAspectRatio}
                            imageAspectRatioOptions={[...IMAGE_ASPECT_RATIO_OPTIONS]}
                            setImageAspectRatio={setImageAspectRatio}
                            selectedTextModel={modelPreference.textModel}
                            selectedImageModel={modelPreference.imageModel}
                            selectedVideoModel={modelPreference.videoModel}
                            textModelOptions={dynamicModelOptions.text}
                            imageModelOptions={dynamicModelOptions.image}
                            videoModelOptions={dynamicModelOptions.video}
                            onTextModelChange={(model) => setModelPreference(prev => ({ ...prev, textModel: model }))}
                            onImageModelChange={(model) => setModelPreference(prev => ({ ...prev, imageModel: model }))}
                            onVideoModelChange={(model) => setModelPreference(prev => ({ ...prev, videoModel: model }))}
                            canvasElements={elements}
                            attachments={promptAttachments}
                            onAddAttachments={handleAddPromptAttachmentFiles}
                            onRemoveAttachment={handleRemovePromptAttachment}
                            onMentionedElementIds={setMentionedElementIds}
                            onEnhancePrompt={handleEnhancePrompt}
                            isEnhancingPrompt={isEnhancingPrompt}
                            isAutoEnhanceEnabled={isAutoEnhanceEnabled}
                            onAutoEnhanceToggle={() => setIsAutoEnhanceEnabled(prev => !prev)}
                            onLockCharacterFromSelection={handleLockCharacterFromSelection}
                            canLockCharacter={!!selectedSingleImage}
                            characterLocks={characterLocks}
                            activeCharacterLockId={activeCharacterLockId}
                            onSetActiveCharacterLock={handleSetActiveCharacterLock}
                            apiConfigs={apiConfigStore.configs}
                            activeApiConfigId={apiConfigStore.activeConfigId}
                            activeApiModelId={apiConfigStore.activeModelId}
                            onApiConfigChange={apiConfigStore.setActiveConfig}
                            onApiModelChange={apiConfigStore.setActiveModel}
                            userApiKeys={userApiKeys}
                            onOpenSettings={() => setIsSettingsPanelOpen(true)}
                        />
                </div>
            </div>
        </div>
    );
};

export default App;

