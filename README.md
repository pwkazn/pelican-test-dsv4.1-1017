# Pelican Point · 鹈鹕的环岛午后

一只鹈鹕骑着薄荷色复古单车，在落日海边的小岛上慢慢绕圈。整个小世界用 three.js 程序化建模，无外部图片素材。

## 运行

直接双击打开 `index.html` 即可（页面使用本地字体与本地 three.js，无需联网）。

也可以启动一个轻量本地服务器：

```bash
npm start
# 然后访问 http://127.0.0.1:4173
```

## 交互

- 拖动：环视鹈鹕与海岛
- 滚轮：缩放
- 双击 / `R`：重置视角
- 空格 / 右下角按钮：暂停或继续骑行

## 文件

- `index.html` — 页面结构与文案
- `css/style.css` — 版式、玻璃拟态 UI、响应式与加载动效
- `js/app.js` — 全部三维场景、鹈鹕/自行车模型、动画与镜头逻辑
- `vendor/three.min.js` — three.js r160，本地运行
- `assets/fonts/` — 本地字体子集
- `screenshots/` — 桌面与移动端预览截图
