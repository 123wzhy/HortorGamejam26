# 舞者动作源文件

此目录只用于本地保存与审计原始 FBX，不属于 Cocos Creator 的 `assets/` 资源数据库：

- `IdleSway.fbx`
- `DanceCombo.fbx`
- `ResultPose.fbx`
- `DanceCombo2.fbx`
- `ResultPose2.fbx`
- `ResultPose3.fbx`
- `IdleSway0.fbx`

FBX、Creator 生成的 `.meta` 和转换器生成的 `.fbm/` 均被 Git 忽略。调用 FBX2glTF 前，
还应把源文件复制到系统临时目录，避免转换器在仓库中产生 `Image_0.png` 等副产物。
运行时只消费 `assets/spine/runtime/BullDancer.gltf`、`assets/spine/runtime/BullAlbedo.jpg`
和 `assets/spine/import/BullDancer.bin`。

当前运行资产中的 `DanceCombo2`、`ResultPose2`、`ResultPose3`、`IdleSway0` 已按源骨名、
相同父级与局部 rest-space 公式重定向，并由 `tools/verify-dancer-assets.mjs` 锁定源 FBX
SHA-256、转换参数、动画时长和 Creator 导入结果。旧 `IdleSway`、`DanceCombo`、
`ResultPose` 保留已验收的运行时数据；未经逐段来源和视觉复核，不得用同名 FBX 直接覆盖。
