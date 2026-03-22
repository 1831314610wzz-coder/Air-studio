# Air-studio Vercel 更新 SOP

这份文档用于记录 `Air-studio` 项目后续部署到 Vercel 的标准操作流程，避免出现“GitHub 已更新，但线上还是旧版本”或“环境变量改了但线上没生效”的问题。

## 1. 基础约定

- GitHub 仓库：`1831314610wzz-coder/Air-studio`
- Vercel 项目：绑定上述仓库
- Production Branch：`main`

建议长期保持这三个设置不变。

## 2. 平时更新代码的标准流程

当你只是修改了前端代码、样式、组件、交互逻辑时，按下面流程操作：

```bash
git add .
git commit -m "更新说明"
git push https://github.com/1831314610wzz-coder/Air-studio.git main
```

完成后：

1. Vercel 会自动检测到 `main` 分支有新提交
2. 自动触发一次新的 Production Deployment
3. 部署完成后，打开生产域名检查效果

## 3. 修改环境变量时的标准流程

当你修改的是以下内容时：

- API Key
- 模型名称
- Base URL
- 分辨率白名单
- 开关型配置

不要只改 GitHub 仓库中的文件，还需要同步到 Vercel 后台。

操作步骤：

1. 打开 Vercel 项目
2. 进入 `Settings -> Environment Variables`
3. 修改对应变量
4. 保存
5. 手动执行一次 `Redeploy`

注意：

- 修改环境变量后，旧部署不会自动拿到新值
- 必须重新部署一次，线上才会生效

## 4. 每次更新后必须检查的内容

每次更新完成后，建议检查下面 4 项：

1. GitHub 是否已经出现最新提交
2. Vercel 最新 Deployment 的 Branch 是否为 `main`
3. Vercel 最新 Deployment 的 Commit 是否等于刚刚 push 的那条提交
4. 页面是否已经强刷一次：`Ctrl + F5`

## 5. 如果线上没有更新，排查顺序

如果你发现 GitHub 更新了，但线上还是旧版本，按下面顺序检查：

### 5.1 GitHub 是否真的有最新提交

打开仓库：

- [https://github.com/1831314610wzz-coder/Air-studio](https://github.com/1831314610wzz-coder/Air-studio)

确认最新提交是否已经在 `main` 上。

### 5.2 Vercel 是否拉到了这条提交

打开：

- `Vercel -> Project -> Deployments`

查看最新 Deployment 对应的：

- Branch
- Commit

如果 Commit 不是最新那条，说明 Vercel 还没部署到正确版本。

### 5.3 是否打开了旧的 Preview 链接

Vercel 常见情况是：

- Preview Deployment 链接是旧版本快照
- Production 域名才是当前正式线上版本

所以不要只看旧的 preview URL，优先看当前项目的 Production Domain。

### 5.4 是否修改了环境变量但没有 Redeploy

如果你刚改过 API key 或模型配置，但没有重新部署，那么线上仍然会沿用旧配置。

## 6. 推荐的固定工作方式

为了减少后续混乱，建议一直按下面规则执行：

- 改代码：`push 到 main`
- 改配置：`改 Vercel Environment Variables + Redeploy`
- 看线上效果：只看 Production 域名

## 7. 特殊情况：强制触发一次新的部署

如果 GitHub 与 Vercel 同步异常，可以推一个空提交强制触发：

```bash
git commit --allow-empty -m "Trigger Vercel redeploy"
git push https://github.com/1831314610wzz-coder/Air-studio.git main
```

## 8. 建议长期保留的习惯

1. 不把真实 API Key 提交到仓库
2. 所有线上密钥只放在 Vercel Environment Variables
3. 每次部署后记录一下最新 commit，方便排查
4. 只维护一套 Production 项目，避免多个项目/多个域名混淆
