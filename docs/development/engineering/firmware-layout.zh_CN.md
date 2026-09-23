<p align="right">
  <strong>简体中文</strong> · <a href="firmware-layout.md">English</a>
</p>

# 固件布局

本 Launcher 分支面向 8 MB Flash ESP32-C3。分区契约预留一个 factory Launcher、三个固定应用位置、Cover Art sidecar 存储，以及标准 ESP-IDF OTA 选择数据。

## Launcher 布局

分区表固定包含：

| 分区 | 类型/子类型 | 偏移 | 大小 | 用途 |
| --- | --- | ---: | ---: | --- |
| `nvs` | data/NVS | `0x9000` | `0x6000` | Launcher 与应用的键值命名空间 |
| `phy_init` | data/PHY | `0xF000` | `0x1000` | PHY 初始化数据 |
| `factory` | app/factory | `0x10000` | `0x170000` | Launcher，最大 1,507,328 字节 |
| `ota_0` | app/OTA 0 | `0x180000` | `0x200000` | 应用位置 1 |
| `ota_1` | app/OTA 1 | `0x380000` | `0x200000` | 应用位置 2 |
| `ota_2` | app/OTA 2 | `0x580000` | `0x200000` | 应用位置 3 |
| `covers` | data/custom `0x40` | `0x780000` | `0x7E000` | A/B Cover Art 记录与 manifest |
| `otadata` | data/OTA | `0x7FE000` | `0x2000` | 标准 ESP-IDF 启动选择数据 |

最后一个分区恰好结束于 `0x800000`。每个应用位置严格为 2 MiB；超过 `0x200000` 的应用镜像必须拒绝。封面数据只存入 `covers`，不得追加到应用镜像。

## 镜像类型

- **完整系统 merged image** 从 `0x0` 开始，包含 bootloader、分区表和 factory Launcher，只用于首次迁移或有意的完整刷新。
- **app-only image** 以 ESP 应用镜像开头；校验通过后，只能写入一个明确选择的 `ota_*` 位置，绝不能刷到 `0x0`。
- 浏览器安装器只有在校验分区表和内嵌应用并提取出应用镜像后，才可以接受兼容的 merged 应用镜像。日常替换位置不得重写 bootloader、分区表、NVS、PHY、Launcher 或无关位置。

完整系统 merged artifact 可能是稀疏文件，因此不能证明未写入的应用或封面区域已经擦除。首次安装器必须显式擦除并校验 `ota_0`、`ota_1`、`ota_2`、六个 cover bank 和 `otadata`，才能报告三个位置全空。

## 强制验证

执行：

```bash
./tools/validate.sh --firmware
```

脚本会在隔离目录中构建并生成合并镜像，从 `flash_args` 读取实际镜像偏移，校验分区表 MD5、分区边界、标签唯一性和分区不重叠，并确认 factory Launcher 位于并装入配置分区。Host test 还会固定每个 Launcher 标签、subtype、偏移、大小、三个相等的 2 MiB 位置，以及严格的 8 MB 终点。CI 执行同一门禁。

完整系统 artifact 与子应用 artifact 必须作为不同产品发布，并使用各自的标签和 hash。名称相近的 `build/FoloToy-AI-Passport.bin` 是 factory Launcher 的 app-only image，不含 bootloader 或分区表，也不是子玩法镜像。

## 烧录与已存数据

> **向设备下载（烧录）新固件前，无需备份设备内部原有固件。** 本流程不要求
> 先读出原固件，也不把保存整片 Flash 镜像作为前置条件。新固件会覆盖原固件；
> 本流程不会保留可自动回滚的副本，也不承诺能够恢复原固件。

固件本体与用户数据不同。如果需要保留已有 NVS 设置、应用记录或文件，应在烧录前通过原应用支持的方式导出或另行保存。无需备份原固件，不代表用户数据一定保留，也不代表可以默认执行全片擦除。

从旧的单 factory 布局切换到本布局会重写分区表，并可能让所有旧地址具有不同含义。真机迁移前，应读取并归档体积很小的现有分区表扇区、审核产品身份数据存储，不能假定未知数据区可以删除。该诊断记录不等于要求备份整份原固件。`meta-pass` 项目的 `cardid` 地址不属于本契约。

经过校验的 merged image 从 `0x0` 写入。它会填充已包含镜像之间的空隙，因此可能重置 NVS 或 PHY，但末段之后仍可能保留旧字节。需要得到三个空位置时，应使用经过审核的首次安装器。正常开发中，如需保留已有状态，应使用分段式 `idf.py flash`，并且要求分区布局兼容、烧录目标不会覆盖这些数据区域。`idf.py erase-flash` 会清除全部用户数据，不应作为常规前置步骤；仅在明确需要全片擦除且已保存需要保留的数据时执行。
