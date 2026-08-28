# 舞者动作源文件

此目录只用于本地保存与审计原始 FBX，不属于 Cocos Creator 的 `assets/` 资源数据库：

- `IdleSway.fbx`
- `DanceCombo.fbx`
- `ResultPose.fbx`
- `DanceCombo2.fbx`
- `ResultPose2.fbx`
- `ResultPose3.fbx`
- `IdleSway0.fbx`

FBX、Creator 生成的 `.meta` 和转换器生成的 `.fbm/` 均被 Git 忽略。使用
`tools/rebuild-dancer-assets.sh` 重建时，脚本会先把源文件复制到系统临时目录，避免转换器
在仓库中产生 `Image_0.png` 等副产物。运行时只消费
`assets/spine/runtime/BullDancer.gltf`、`assets/spine/runtime/OriginalDancerAlbedo.jpg` 和
`assets/spine/import/BullDancer.bin`。

当前模型、材质、UV 与 33-joint 骨架以 `IdleSway0.fbx` 为基准，另外五段非待机动作按唯一
骨名、相同父级与局部 rest-space 公式重定向。七份 FBX 的源纹理字节一致；8192 PNG 仅在
临时目录提取，运行时检入其 2048/Q85 JPEG 派生图。原始 `IdleSway.fbx` 的动作数据实际与
`DanceCombo.fbx` 相同，不能作为待机；稳定运行名 `IdleSway` 与 `IdleSway0` 因此共享
`IdleSway0.fbx` 的动画 accessor。`tools/verify-dancer-assets.mjs` 锁定七份源 FBX SHA-256、
模型/纹理 provenance、动画时长、重定向公式与 Creator 真实导入结果。
