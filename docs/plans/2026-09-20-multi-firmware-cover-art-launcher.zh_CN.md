<p align="right">
  <strong>简体中文</strong> · <a href="2026-09-20-multi-firmware-cover-art-launcher.md">English</a>
</p>

# 多固件 Cover Art 启动器实施规划

产品与交互基线：[多固件 Cover Art 启动器设计规范](2026-09-21-multi-firmware-cover-art-launcher-design.zh_CN.md)

> **给 Claude：** 实施时必须使用 `executing-plans` 技能，按任务逐项执行。

**目标：** 建设一个拥有三个固定玩法位置、最多容纳三个独立应用镜像的 factory Launcher，以 Cover Art 卡片展示并启动所选应用，同时支持安全返回或回滚到 Launcher。

**架构：** 保留 ESP-IDF 标准二级 bootloader。普通 `factory` 应用负责 BSP/LVGL UI，通过 OTA API 选择三个 `ota_*` 应用分区之一。app-only 镜像写入 OTA 槽；标题、120×160 RGB565 封面、校验值、代次以及所绑定的应用 SHA-256 写入原始 `covers` 分区的 A/B sidecar。先交付可靠的文字 Launcher，再接安装器，最后启用 Cover Art；SoftAP 上传不进入 MVP 验收门槛。

**技术栈：** ESP-IDF 5.5.3、ESP32-C3、标准 OTA/rollback API、LVGL、当前 BSP、C11 主机测试、Python 固件布局测试、浏览器 JavaScript/Web Serial、Node.js 测试。

---

## 1. 范围与确定事项

### MVP 包含

- 一个 `factory` Launcher 和三个 2 MiB 应用槽。
- 空、损坏、试运行和可用等槽位状态。
- 合法的首次全空玩法库。Launcher 安装完成后，用户可以跳过首个玩法安装。
- `UP`/`DOWN` 切换卡片，`OK` 单击启动，`OK` 长按查看详情。
- 图形卡片启用前，先交付纯文字启动界面。
- 浏览器安装 app-only 镜像或从 `0x0` 开始的 merged 镜像。
- 安装时写入标题和封面 sidecar；封面缺失/损坏时使用内置占位图。
- 通过 SHA-256 将封面记录与槽内应用镜像绑定。
- 通用应用采用一次性启动；复位返回后保留名称、封面和再次启动入口；已适配应用可选提供应用内返回接口。
- 主机测试、固件校验和真机验收矩阵。

### MVP 真机通过后再做

- 设备 SoftAP/HTTP 上传、三个以上应用、在线商店和后台下载。
- 设备端 JPEG/PNG 解码；v1 只保存浏览器转换后的 RGB565。
- Secure Boot、Flash Encryption，以及对恶意子固件的隔离。
- 将 `.rodata_custom_desc` 作为主要元数据来源；以后只为受控构建提供可选支持。

### 产品边界

这是多启动，不是并发运行。任一时刻只运行一个应用，切换需要重启。不同游戏放入不同槽位；语言、难度和模式继续留在单个应用内部。

Launcher 安装完成与首个玩法安装完成是两个独立状态。用户可以在三个位置都为空时结束首次设置；这是正常的玩法库状态，不是安装失败。设备需要明确引导用户通过电脑端安装器添加玩法。

## 2. 暂定 8 MB Flash 契约

读取并审核目标设备当前分区表和产品身份数据要求之前，不得把此布局写入设备。尤其不能照抄 meta-pass 项目专用的 `cardid` 地址。

| 分区 | 类型/子类型 | 偏移 | 大小 | 用途 |
| --- | --- | ---: | ---: | --- |
| `nvs` | data/NVS | `0x9000` | `0x6000` | Launcher 与子应用各自的命名空间 |
| `phy_init` | data/PHY | `0xF000` | `0x1000` | PHY 初始化数据 |
| `factory` | app/factory | `0x10000` | `0x170000` | Launcher，最大约 1.44 MiB |
| `ota_0` | app/OTA 0 | `0x180000` | `0x200000` | 应用槽 0 |
| `ota_1` | app/OTA 1 | `0x380000` | `0x200000` | 应用槽 1 |
| `ota_2` | app/OTA 2 | `0x580000` | `0x200000` | 应用槽 2 |
| `covers` | data/自定义 `0x40` | `0x780000` | `0x7E000` | A/B 封面记录和 manifest |
| `otadata` | data/OTA | `0x7FE000` | `0x2000` | ESP-IDF 标准启动选择数据 |

分区结尾正好为 `0x800000`。完整 app image 不得大于 `0x200000`；封面数据绝不追加在 app 槽尾部。

### Cover bank 布局

每个应用在 `covers` 中拥有两个 64 KiB bank：

```text
槽 0：A 0x00000，B 0x10000
槽 1：A 0x20000，B 0x30000
槽 2：A 0x40000，B 0x50000
```

每个 bank 的前 4 KiB 保存序列化 manifest，payload 从 `0x1000` 开始。120×160 RGB565 封面为 38,400 字节。安装器擦除并写入非活动 bank，校验 payload，最后写入有效 manifest。Launcher 选择 firmware SHA 与槽位匹配且 generation 最大的有效记录，使更新中断后仍可回到旧 bank。

持久化时必须按固定偏移和 little-endian 显式编码，不能直接写入存在编译器 padding 的 C struct：

```c
#define LAUNCHER_COVER_MAGIC 0x31525643u /* "CVR1" */
#define LAUNCHER_COVER_SCHEMA 1u
#define LAUNCHER_TITLE_MAX 64u
#define LAUNCHER_SOURCE_ID_MAX 48u
#define LAUNCHER_VERSION_MAX 24u

typedef struct {
    uint32_t generation;
    uint8_t slot_id;
    uint8_t source_kind;
    uint16_t width;
    uint16_t height;
    uint32_t payload_length;
    uint32_t payload_crc32;
    uint8_t firmware_sha256[32];
    char title[LAUNCHER_TITLE_MAX + 1];
    char source_id[LAUNCHER_SOURCE_ID_MAX + 1];
    char version[LAUNCHER_VERSION_MAX + 1];
} launcher_cover_manifest_t;
```

schema v1 只接受 `120×160`、RGB565 且 `payload_length == 38400`。玩法 API 安装保存如 `play:281` 的稳定 `source_id`；本地文件可以留空，因此不能自动匹配原位更新。未知 schema、非法长度/UTF-8、CRC 错误和 SHA 不匹配均退化为占位图，不能阻止 Launcher 启动。

## 3. 交付门槛

| 阶段 | 结果 | 进入下一阶段前必须通过 |
| --- | --- | --- |
| A | 分区与纯逻辑契约 | 静态检查、布局测试、manifest 测试 |
| B | 文字多固件 Launcher | 三个真实 app 可启动；三张卡片都可导航，但空槽/坏槽绝不成为启动目标 |
| C | 通用返回与再次启动 | 通用应用复位后返回、保持已安装并可再次启动；可选的已适配返回可用 |
| D | Web Serial 安装 | 完整系统、app-only 与 merged-image 路径均通过布局/大小/SHA 校验和中断恢复 |
| E | Cover Art | A/B 更新、占位退化和低内存渲染通过真机验证 |
| F | 可选 SoftAP | 只有 A–E 通过并重新测量 RAM/Flash 余量后才进入 |

## 4. 实施任务

### 任务 1：建立隔离的 Launcher 分支并固定借鉴边界

**文件：**

- 实施时新建：基于上游 `main` 的托管 worktree，分支名 `feature/multi-firmware-launcher`。
- 新建：`tools/install-slot/LICENSE.meta-pass.txt`
- 新建：`docs/reference/meta-pass-borrowing.md`
- 新建：`docs/reference/meta-pass-borrowing.zh_CN.md`

**步骤：**

1. 记录当前分支和状态；不把 Penalty shell 合并进 Launcher。
2. 建立隔离分支/worktree，并确认工作区干净。
3. 将 meta-pass 提交 `994caaf52357d97323bffb82b2db9cc784afb1eb` 固定为参考基线，而不是移动依赖。
4. 记录复制或实质改编的安装器文件，并保留 MIT notice。
5. 明确不继承 meta-pass 的分区表、`cardid`、4 KiB/8 KiB 槽尾约定和 UI。
6. 若已获准提交，只提交这些归属与参考文件。

### 任务 2：冻结并测试分区契约

**文件：**

- 修改：`partitions.csv`
- 修改：`docs/development/engineering/firmware-layout.md`
- 修改：`docs/development/engineering/firmware-layout.zh_CN.md`
- 修改：`tests/test_verify_firmware.py`
- 仅在需要时修改：`tools/verify_firmware.py`

**步骤：**

1. 先写失败测试，断言上述 label、偏移、大小、无重叠、`0x800000` 结尾，以及三个相同的 2 MiB 应用槽。
2. 运行 `PYTHONDONTWRITEBYTECODE=1 python3 tests/test_verify_firmware.py`，确认新断言失败。
3. 用已审核的 Launcher 布局替换单 factory 分区表。
4. 同步更新两种语言的 firmware-layout 文档，说明 full image/app-only 规则和迁移风险。
5. 运行专项测试及 `./tools/validate.sh --static`，预期 PASS。
6. 在任何真机写入前，读取并归档设备已有分区表扇区，确认没有覆盖身份数据。

### 任务 3：实现可主机测试的 cover manifest codec

**文件：**

- 新建：`main/launcher_manifest.h`
- 新建：`main/launcher_manifest.c`
- 新建：`tests/test_launcher_manifest.c`
- 修改：`tools/validate.sh`

**API：**

```c
bool launcher_manifest_encode(uint8_t out[256],
                              const launcher_cover_manifest_t *manifest);
bool launcher_manifest_decode(launcher_cover_manifest_t *out,
                              const uint8_t *bytes, size_t length);
bool launcher_manifest_matches_image(const launcher_cover_manifest_t *manifest,
                                     const uint8_t image_sha256[32]);
```

**步骤：**

1. 先写表驱动失败测试：合法往返、错误 magic/schema、非法 slot/尺寸、payload 超限、非法 UTF-8、玩法 API 来源缺少 `source_id`、本地来源 `source_id` 为空，以及 SHA 不匹配。
2. 用 `cc -std=c11 -Wall -Wextra -Werror -Imain tests/test_launcher_manifest.c main/launcher_manifest.c` 编译并确认失败。
3. 实现固定偏移 little-endian 序列化，不依赖 ESP-IDF/LVGL。
4. 将测试加入 `tools/validate.sh` 并运行到 PASS。

### 任务 4：先以纯逻辑实现槽位发现与选择

**文件：**

- 新建：`main/launcher_model.h`, `main/launcher_model.c`
- 新建：`main/launcher_slots.h`, `main/launcher_slots.c`
- 新建：`tests/test_launcher_model.c`
- 修改：`tools/validate.sh`

```c
typedef enum {
    LAUNCHER_SLOT_EMPTY,
    LAUNCHER_SLOT_INVALID,
    LAUNCHER_SLOT_TRIAL,
    LAUNCHER_SLOT_READY,
} launcher_slot_state_t;
```

**步骤：**

1. 先写失败测试：在三张卡片间循环导航、全空槽、刷新，以及拒绝把空槽/坏槽作为启动目标。
2. 实现不依赖分区 API 的纯逻辑 model。
3. 使用 `esp_partition_find_first()`、镜像校验和 `esp_ota_get_partition_description()` 实现 ESP-IDF adapter。
4. 以有界 chunk 流式计算 app SHA-256，禁止申请与镜像等大的缓冲区。
5. 运行 model 测试和 `./tools/validate.sh --static` 到 PASS。

### 任务 5：跑通文字 Launcher 与标准启动切换

**文件：**

- 在 Launcher 分支替换：`main/main.c`
- 新建：`main/launcher_ui.h`, `main/launcher_ui.c`
- 新建：`main/launcher_boot.h`, `main/launcher_boot.c`
- 修改：`main/CMakeLists.txt`
- 仅在实测需要时修改：`sdkconfig.defaults`

**步骤：**

1. 增加契约测试，要求使用 BSP 显示/按键、输入队列和标准 OTA API。
2. 通过 BSP 初始化；按键回调保持非阻塞，通过 queue 投递事件。
3. 三个槽都为空时，显示专用首次空库界面：三个空位置、“连接电脑添加玩法”和安装器地址/帮助入口；不能显示错误或强制进入安装。
4. 其他情况下显示槽号、标题/项目名、版本、大小和状态。坏槽可见但不能启动。
5. 实现 `UP`/`DOWN`、`OK` 单击和 `OK` 长按详情。
6. 启动前再次校验；成功调用 `esp_ota_set_boot_partition(target)` 后才能重启。
7. 运行 `./tools/validate.sh --firmware`；Launcher 必须放得进 `factory`，merged image 校验通过。
8. 真机验证冷启动、全空槽、每个已安装槽、坏镜像拒绝和连续选择 30 次。

### 任务 6：定义通用玩法一次性返回与可选适配返回

**文件：**

- 新建：`components/launcher_contract/CMakeLists.txt`
- 新建：`components/launcher_contract/include/launcher_contract.h`
- 新建：`components/launcher_contract/launcher_contract.c`
- 新建：`tests/test_launcher_boot_policy.c`
- 在每个已适配子应用中修改：应用 shell 和 component manifest。

```c
esp_err_t launcher_contract_mark_valid(void);
esp_err_t launcher_contract_return_to_factory(void);
```

**步骤：**

1. 先写 factory、首次一次性启动、复位后恢复可再次启动、已确认 app、坏镜像和显式返回的策略测试。
2. 基于 ESP-IDF 5.5.3 移植 meta-pass 已验证的 rollback 顺序，记录每个 OTA 状态转换。
3. `return_to_factory()` 必须解析 factory、成功设置目标后再重启。
4. 首先适配 Penalty，不改变它的模式和自身封面页。
5. 验证通用玩法复位返回并可再次启动，以及可选的已适配 app 确认/返回。v1 不设置自动超时：通用玩法持续运行到复位/重新上电，随后因为从未确认自身而返回 Launcher；rollback 产生的 `ABORTED` 状态按可用处理，明确的镜像无效状态仍被阻止。
6. 验证所有 Launcher 二级界面统一使用 `OK` 长按返回 Cover Art 玩法库。
7. 在各转换点断电，记录下一次启动目标。

### 任务 7：实现首次完整系统安装

**文件：**

- 新建：`tools/install-slot/system-install.js`
- 新建：`tools/install-slot/test-system-install.mjs`
- 新建：`tools/install-slot/index.html`, `tools/install-slot/app.js`
- 新建：`tools/install-slot/README.md`, `tools/install-slot/README.zh_CN.md`
- 修改：`tools/validate.sh`

**步骤：**

1. 先写状态机失败测试：识别当前单 factory 布局、已有兼容 Launcher 布局、未知布局、用户取消、断连、完整写入失败、校验失败，以及三个位置全空时成功完成。
2. 提供迁移前读取芯片、Flash 大小和当前分区表扇区。无法确认芯片、容量或布局时拒绝自动迁移，不能推断未知数据分区可以删除。
3. 显示一次性警告：安装多玩法系统会重写 bootloader、分区表、factory Launcher、OTA metadata，以及三个位置的全部 app/cover 区域，并可能重置已有设置。
4. 先校验签名/发布的完整镜像 SHA。从 `0x0` 写入已验证的稀疏 Launcher merged image 前，必须显式擦除所有应为空的区域：`ota_0`、`ota_1`、`ota_2`、三个位置各自的两份 cover bank，以及 `otadata`；不能把 merged image 中的空洞当作已经擦除。
5. 校验每个已写系统段；对每段擦除范围的首尾进行回读抽查；确认不存在已选 OTA 条目；然后重启进入 Launcher。读取不到兼容布局和 factory image、或三个位置扫描结果不全为空时，都不能显示成功。未来只有在空白填充规则和整镜像 SHA 都纳入发布契约后，才可以用完整 8 MiB 镜像替代这一流程。
6. v1 不续传残缺的完整系统写入。断连或断电后，引导用户重新进入 ROM 下载模式，连接后从头重做完整系统安装。
7. 成功后并列提供“安装第一个玩法”和“暂不安装，进入空玩法库”；跳过首个玩法不属于取消或失败。
8. 将 `node --test tools/install-slot/test-system-install.mjs` 加入 static gate；Gate D 通过前必须完成真机的安装中断恢复测试。

### 任务 8：移植并加固玩法位置安装

**文件：**

- 修改：`tools/install-slot/index.html`, `tools/install-slot/app.js`
- 新建：`tools/install-slot/extract-app-image.js`, `tools/install-slot/cover-convert.js`
- 新建：`tools/install-slot/test-extract-app-image.mjs`, `test-cover-convert.mjs`
- 修改：`tools/install-slot/README.md`, `tools/install-slot/README.zh_CN.md`
- 修改：`tools/validate.sh`

**步骤：**

1. 从固定源码移植 merged-image parser，并保留 MIT notice。
2. 测试 app-only、合法 merged、分区表 MD5 错误、缺少 factory image、segment 截断、非 ESP 镜像、严格超过 `0x200000`。
3. 接受玩法 URL/API 响应，或本地固件加可选本地封面。目标推荐顺序为：相同 `source_id` 原位更新；否则第一个空位置；否则由用户明确选择替换位置。
4. 提取前校验发布/下载 SHA；提取后显示写入 manifest 的 app SHA。
5. Web Serial 只写所选 OTA 槽和非活动 cover bank；替换槽位时绝不写 NVS、PHY、Launcher 或分区表。
6. app 擦除/写入/校验失败时，把目标标记为“安装未完成”，拒绝其成为启动目标。只有封面在 app 校验后写入失败时，app 使用占位图保持可启动，并提供“只重试封面”。v1 不续传 app，断线后从擦除/写入阶段重做。
7. 将 `node --test tools/install-slot/test-*.mjs` 加入 static gate 并运行到 PASS。

### 任务 9：加入 Cover Art 存储和图形选择器

**文件：**

- 新建：`main/launcher_cover_store.h`, `main/launcher_cover_store.c`
- 新建：`main/launcher_cover_view.h`, `main/launcher_cover_view.c`
- 新建：`assets/images/launcher/placeholder-cover.*`
- 新建：`tests/test_launcher_cover_store.c`, `tests/test_launcher_art_contract.py`
- 修改：`main/launcher_ui.c`, `main/CMakeLists.txt`
- 修改：`assets/README.md`, `assets/README.zh_CN.md`

**步骤：**

1. 测试 bank 选择、generation 回绕、擦除/残缺 bank、CRC/SHA 错误，以及回退到旧有效 bank。
2. 实现严格有界的 raw partition 读取，不做无界内存申请。
3. 浏览器将封面转换为严格的 120×160 RGB565；设备端不解码 PNG/JPEG。
4. 使用有界 draw buffer 从 Flash 绘制当前 120×160 封面；流式读取/裁剪左右相邻位置各 `20–24 px` 的边缘，不让三张完整封面同时常驻 RAM。
5. 增加标题、版本、位置状态、电量和三个位置指示器；电量与封面缺失时分别退化。
6. 测试在可用、空、trial、未完成和封面无效状态下，UP/DOWN、中央封面、两侧露出、标题和指示器保持同步。
7. 真机验证三个卡片，其中一个记录损坏时仍保持响应。
8. 记录 UI 创建前、扫描后、切卡 100 次后的 heap；单调泄漏不通过真机门槛。

### 任务 10：补齐文档并执行发布级验收

**文件：**

- 新建：`docs/software/multi-firmware-launcher.md`
- 新建：`docs/software/multi-firmware-launcher.zh_CN.md`
- 修改：`docs/README.md`, `docs/README.zh_CN.md`
- 若命令变化，同步修改权威构建/刷写文档。

**步骤：**

1. 记录流程、槽位状态、app-only/merged 区别、恢复、共享 NVS，以及 SHA/签名不能隔离子固件。
2. 记录安全迁移：先检查/备份，只完整刷入一次 Launcher 布局，此后更换槽位不重写分区表。
3. 在 ESP-IDF 5.5.3 下依次运行 `./tools/validate.sh --static`、`./tools/validate.sh --firmware`、`./tools/validate.sh`，均应 PASS。
4. 执行下方真机矩阵。不能用构建结果代替功能完成。

## 5. 必须完成的真机验收矩阵

- 三个槽全空：Launcher 设置已完成，空玩法库可正常操作，并引导前往电脑端安装器，不提供无效启动目标。
- 首次完整系统安装：显示迁移警告，成功后校验兼容布局/factory image；写入中断时可以通过 ROM 下载模式从头恢复。
- 三个合法应用：每个都能从冷启动和 Launcher 选择进入。
- app-only 与 merged 安装：槽内 app SHA 与安装器报告一致。
- 超大、截断、错误芯片镜像：在启动选择改变前被拒绝。
- 封面缺失/损坏/写入失败：显示占位图；已校验 app 仍可启动，且只重试封面不会重写 app。
- 写 app、payload、manifest 时分别断电：恢复旧有效状态或安全的不可启动状态；所有卡片仍可导航。
- 通用玩法复位返回后保留已安装卡片并可再次启动；可选的已适配返回符合文档。
- 连续切槽 30 次、切卡 100 次：无崩溃、按键卡死或 heap 单调泄漏。
- 每种轮播状态都同步显示左右各 `20–24 px` 的相邻位置露出和三个位置指示器。
- Launcher 使用独立 NVS namespace，经过子应用使用后仍保留数据。
- 日常槽位替换在承诺范围内保留 NVS/PHY 和其他槽。

最终报告必须分别给出：

```text
Build: PASS / FAIL / NOT RUN
Host tests: PASS / FAIL / NOT RUN
Device tests: PASS / FAIL / NOT RUN
Unverified: remaining board, power-loss, security, or installer checks
```

## 6. 可选第二阶段：SoftAP 上传

只有 A–E 通过，且重新测量 Flash/内部 RAM 余量后才开始。SoftAP 必须复用 Web Serial 的镜像解析、容量规则、SHA 绑定、cover manifest 和失败清理，不能创建第二套存储契约。HTTP 以流式方式写入非活动目标，UI 状态投递给 LVGL task。默认启用前必须测试断连、超时、重复 chunk、Content-Length 不一致和 finalization 期间重启。
