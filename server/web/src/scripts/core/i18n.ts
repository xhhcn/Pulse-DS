/**
 * Two-language dictionary (en / zh) shared by every page.
 *
 * Static markup uses data-i18n / data-i18n-placeholder / data-i18n-title
 * attributes and is refreshed by applyI18n(); dynamically rendered HTML
 * calls t() at render time and re-renders on the `pulse:lang` event.
 */
export type Lang = 'en' | 'zh';

const D: Record<string, [string, string]> = {
  // ---- common
  'common.cancel': ['Cancel', '取消'],
  'common.save': ['Save', '保存'],
  'common.saving': ['Saving…', '保存中…'],
  'common.close': ['Close', '关闭'],
  'common.copy': ['Copy', '复制'],
  'common.copied': ['Copied', '已复制'],
  'common.copyFailed': ['Copy failed', '复制失败'],
  'common.delete': ['Delete', '删除'],
  'common.deleting': ['Deleting…', '删除中…'],
  'common.refresh': ['Refresh', '刷新'],
  'common.loading': ['Loading…', '加载中…'],
  'common.noData': ['No data', '暂无数据'],
  'common.notReported': ['Not reported', '未上报'],
  'common.online': ['Online', '在线'],
  'common.offline': ['Offline', '离线'],
  'common.all': ['All', '全部'],
  'common.none': ['None', '无'],
  'common.yes': ['Yes', '是'],
  'common.no': ['No', '否'],
  'common.seconds': ['seconds', '秒'],
  'common.hours': ['hours', '小时'],
  'common.error': ['Error', '错误'],
  'common.back': ['Back', '返回'],
  'common.home': ['Home', '首页'],
  'common.admin': ['Admin', '管理'],
  'common.language': ['Switch to 中文', '切换到 English'],
  'common.themeDark': ['Switch to dark mode', '切换到深色模式'],
  'common.themeLight': ['Switch to light mode', '切换到浅色模式'],
  'common.previous': ['Previous', '上一个'],
  'common.next': ['Next', '下一个'],
  'common.required': ['Required', '必填'],
  'common.unknown': ['Unknown', '未知'],

  // ---- live indicator
  'live.live': ['Live', '实时'],
  'live.reconnecting': ['Reconnecting', '重连中'],
  'live.offline': ['Disconnected', '已断开'],

  // ---- dashboard
  'dash.title': ['Servers', '服务器'],
  'dash.subtitle': ['Updated in real time · click a server for details', '实时更新 · 点击服务器查看详情'],
  'dash.search': ['Search name, location, OS, CPU…', '搜索名称、位置、系统、CPU…'],
  'dash.sort': ['Sort', '排序'],
  'dash.sortBy': ['Sort by', '排序方式'],
  'dash.sort.default': ['Default order', '默认顺序'],
  'dash.sort.name': ['Name', '名称'],
  'dash.sort.uptime': ['Uptime', '运行时间'],
  'dash.sort.os': ['OS', '系统'],
  'dash.sort.cpu': ['CPU usage', 'CPU 占用'],
  'dash.sort.memory': ['Memory usage', '内存占用'],
  'dash.sort.disk': ['Disk usage', '磁盘占用'],
  'dash.sort.health': ['Health', '硬件健康'],
  'dash.sort.asc': ['Ascending', '升序'],
  'dash.sort.desc': ['Descending', '降序'],
  'dash.stat.total': ['Total', '总数'],
  'dash.stat.online': ['Online', '在线'],
  'dash.stat.offline': ['Offline', '离线'],
  'dash.stat.attention': ['Hardware alerts', '硬件告警'],
  'dash.stat.attentionSub': ['{crit} critical · {warn} warning', '{crit} 严重 · {warn} 注意'],
  'dash.stat.allGood': ['All hardware healthy', '硬件全部正常'],
  'dash.stat.noHardware': ['No hardware data yet', '暂无硬件数据'],
  'dash.stat.dsCount': ['{n} dedicated', '{n} 台独服'],
  'dash.stat.vpsCount': ['{n} VPS', '{n} 台 VPS'],
  'dash.col.server': ['Server', '服务器'],
  'dash.col.health': ['Health', '健康'],
  'dash.col.uptime': ['Uptime', '运行'],
  'dash.col.location': ['Location', '位置'],
  'dash.col.cpu': ['CPU', 'CPU'],
  'dash.col.memory': ['Memory', '内存'],
  'dash.col.disk': ['Disk', '磁盘'],
  'dash.col.net': ['Network', '网络'],
  'dash.col.os': ['OS', '系统'],
  'dash.empty.title': ['No servers yet', '还没有服务器'],
  'dash.empty.desc': ['Servers appear here once an agent starts reporting.', '探针开始上报后，服务器会显示在这里。'],
  'dash.empty.filtered': ['No servers match the current filter.', '没有符合当前筛选条件的服务器。'],
  'dash.empty.clear': ['Clear filters', '清除筛选'],
  'dash.error.title': ['Could not reach the backend', '无法连接到后端'],
  'dash.error.retry': ['Retry', '重试'],
  'dash.copyName': ['Copy name', '复制名称'],
  'dash.openDetails': ['Open details', '查看详情'],
  'dash.filter.attention': ['Needs attention', '需要关注'],

  // ---- health
  'health.ok': ['Healthy', '正常'],
  'health.warn': ['Attention', '注意'],
  'health.critical': ['Critical', '严重'],
  'health.unknown': ['Unknown', '未知'],
  'health.na': ['—', '—'],
  'health.issues': ['{n} issues', '{n} 个问题'],
  'health.issue': ['1 issue', '1 个问题'],

  // ---- detail modal
  'detail.tab.overview': ['Overview', '概览'],
  'detail.tab.hardware': ['Hardware', '硬件'],
  'detail.tab.tcping': ['TCPing', 'TCPing'],
  'detail.updated': ['Updated', '更新于'],
  'detail.agent': ['Agent', '探针'],
  'detail.type.DS': ['Dedicated', '独立服务器'],
  'detail.type.VPS': ['VPS', 'VPS'],
  'detail.cpu': ['CPU', 'CPU'],
  'detail.memory': ['Memory', '内存'],
  'detail.disk': ['Disk', '磁盘'],
  'detail.swap': ['Swap', '交换分区'],
  'detail.network': ['Network', '网络'],
  'detail.download': ['Down', '下行'],
  'detail.upload': ['Up', '上行'],
  'detail.totalIn': ['Total in', '累计接收'],
  'detail.totalOut': ['Total out', '累计发送'],
  'detail.system': ['System', '系统'],
  'detail.load': ['Load (1 / 5 / 15 min)', '负载 (1 / 5 / 15 分钟)'],
  'detail.topology': ['Topology', '拓扑'],
  'detail.frequency': ['Frequency', '频率'],
  'detail.kernel': ['Kernel', '内核'],
  'detail.ecc': ['ECC', 'ECC'],
  'detail.eccNone': ['not reported', '未上报'],
  'detail.eccCounts': ['{ce} correctable · {ue} uncorrectable', '可纠正 {ce} · 不可纠正 {ue}'],
  'detail.rebootRequired': ['Reboot required', '需要重启'],
  'detail.location': ['Location', '位置'],
  'detail.os': ['Operating system', '操作系统'],
  'detail.uptime': ['Uptime', '运行时间'],
  'detail.issues': ['Issues', '问题'],
  'detail.noIssues': ['No hardware issues detected', '未检测到硬件问题'],
  'detail.noHardware': ['This agent does not report hardware details yet.', '该探针尚未上报硬件详情。'],
  'detail.hwCollected': ['Collected', '采集于'],
  'detail.tags': ['Tags', '标签'],
  'detail.model': ['Model', '型号'],
  'detail.maxFreq': ['max {v}', '最高 {v}'],
  'detail.cache': ['L3 {v}', 'L3 {v}'],
  'detail.machine': ['Machine', '整机'],
  'detail.serial': ['Serial number', '序列号'],
  'detail.board': ['Mainboard', '主板'],
  'detail.bios': ['BIOS', 'BIOS'],
  'detail.memoryModules': ['{n} × {size} {type}', '{n} × {size} {type}'],
  'detail.interfaces': ['Interfaces', '网卡'],
  'detail.latency': ['Latency', '延迟'],
  'settings.showTags': ['Show tags', '显示标签'],
  'settings.showTagsDesc': ['Tags are shown in the server detail dialog.', '标签显示在服务器详情弹窗的头部。'],
  'detail.moreIssues': ['Show {n} more', '展开其余 {n} 项'],
  'detail.lessIssues': ['Show less', '收起'],
  'detail.traffic': ['Total traffic', '累计流量'],
  'detail.disksLine': ['{n} × {kind} · {size}', '{n} × {kind} · {size}'],
  'detail.smartOk': ['S.M.A.R.T. OK', 'S.M.A.R.T. 正常'],
  'detail.smartFailed': ['{n} S.M.A.R.T. failed', '{n} 块 S.M.A.R.T. 故障'],
  'detail.linkUp': ['up', '已连接'],
  'detail.linkDown': ['down', '断开'],
  'detail.linkDisabled': ['disabled', '未启用'],
  'detail.linkUnknown': ['unknown', '未知'],
  'hw.summary': ['Summary', '概要'],
  'hw.currentFreq': ['Current clock', '当前频率'],
  'hw.maxFreq': ['Max clock', '最高频率'],
  'hw.baseFreq': ['Base clock', '基准频率'],
  'hw.eccErrors': ['ECC errors', 'ECC 错误'],
  'hw.load': ['Load 1 / 5 / 15 min', '负载 1 / 5 / 15 分钟'],
  'detail.noInterfaces': ['No interface details reported', '未上报网卡详情'],
  'detail.eccYes': ['ECC', 'ECC'],
  'detail.eccNo': ['non-ECC', '非 ECC'],
  'detail.sockets': ['{n} sockets', '{n} 路'],
  'detail.cores': ['{n} cores', '{n} 核'],
  'detail.threads': ['{n} threads', '{n} 线程'],

  // ---- hardware sections
  'hw.disks': ['Disks', '磁盘'],
  'hw.memory': ['Memory', '内存'],
  'hw.processor': ['Processor', '处理器'],
  'hw.topology': ['Topology', '拓扑'],
  'hw.l3': ['L3 cache', '三级缓存'],
  'hw.total': ['Total', '总量'],
  'hw.modules': ['{n} modules', '{n} 条'],
  'hw.module': ['1 module', '1 条'],
  'hw.unifiedMemory': ['Unified', '统一内存'],
  'hw.nominal': ['spec', '规格值'],
  'hw.written': ['written', '已写入'],
  'hw.smartHint': ['Temperature, power-on time and wear come from smartctl; install smartmontools on this host (macOS: brew install smartmontools).', '温度、通电时间与磨损由 smartctl 提供；请在该主机安装 smartmontools（macOS：brew install smartmontools）。'],
  'hw.eccSupported': ['Supported', '支持'],
  'hw.eccNot': ['Not supported', '不支持'],
  'hw.firmware': ['BIOS / firmware', 'BIOS / 固件'],
  'hw.graphics': ['Graphics', '图形'],
  'hw.onboard': ['onboard', '板载'],
  'hw.system': ['System', '系统'],
  'hw.col.slot': ['Slot', '插槽'],
  'hw.col.type': ['Type', '类型'],
  'hw.col.speed': ['Speed', '频率'],
  'hw.col.manufacturer': ['Manufacturer', '品牌'],
  'hw.col.part': ['Part number', '型号'],
  'hw.col.ecc': ['ECC', 'ECC'],
  'hw.col.life': ['Life left', '剩余寿命'],
  'hw.col.written': ['Written', '累计写入'],
  'hw.col.sectors': ['Bad sectors', '坏扇区'],
  'hw.configured': ['running at {v}', '运行于 {v}'],
  'hw.filesystems': ['Filesystems', '文件系统'],
  'hw.raid': ['RAID / ZFS', 'RAID / ZFS'],
  'hw.sensors': ['Sensors', '传感器'],
  'hw.sensorGroup.temp': ['Temperature', '温度'],
  'hw.sensorGroup.fan': ['Fans', '风扇'],
  'hw.sensorGroup.volt': ['Voltage', '电压'],
  'hw.sensorGroup.power': ['Power', '功率 / 电流'],
  'hw.sensorGroup.psu': ['Power supplies', '电源'],
  'hw.sensor.cores': ['CPU cores ({n})', 'CPU 核心 ({n})'],
  'hw.sensor.more': ['{n} more', '更多 {n} 项'],
  'hw.sensor.less': ['Show less', '收起'],
  'hw.sensor.show': ['Show', '展开'],
  'hw.sensor.voltOk': ['{n} rails · all within range', '{n} 路 · 均在范围内'],
  'hw.sensor.voltBad': ['{n} rails · {bad} out of range', '{n} 路 · {bad} 路超出范围'],
  'hw.network': ['Network interfaces', '网卡'],
  'hw.gpu': ['GPU', 'GPU'],
  'hw.col.device': ['Device', '设备'],
  'hw.col.model': ['Model', '型号'],
  'hw.col.size': ['Size', '容量'],
  'hw.col.smart': ['S.M.A.R.T.', 'S.M.A.R.T.'],
  'hw.col.temp': ['Temp', '温度'],
  'hw.col.hours': ['Power-on', '通电'],
  'hw.col.wear': ['Wear / sectors', '磨损 / 扇区'],
  'hw.col.io': ['Read / write', '读 / 写'],
  'hw.col.iops': ['IOPS', 'IOPS'],
  'hw.col.util': ['Busy', '繁忙'],
  'hw.col.mount': ['Mount', '挂载点'],
  'hw.col.fstype': ['Type', '类型'],
  'hw.col.used': ['Used', '已用'],
  'hw.col.link': ['Link', '链路'],
  'hw.col.state': ['State', '状态'],
  'hw.col.rate': ['Rx / Tx', '收 / 发'],
  'hw.col.errors': ['Errors / drops', '错误 / 丢弃'],
  'hw.col.array': ['Array', '阵列'],
  'hw.col.level': ['Level', '级别'],
  'hw.col.members': ['Members', '成员'],
  'hw.col.memory': ['Memory', '显存'],
  'hw.col.usage': ['Usage', '使用率'],
  'hw.smart.passed': ['PASSED', '正常'],
  'hw.smart.failed': ['FAILED', '故障'],
  'hw.smart.unknown': ['n/a', '未知'],
  'hw.degraded': ['Degraded', '降级'],
  'hw.rebuilding': ['Rebuilding {pct}%', '重建中 {pct}%'],
  'hw.healthy': ['Healthy', '正常'],
  'hw.wear': ['wear {pct}%', '磨损 {pct}%'],
  'hw.spare': ['spare {pct}%', '备件 {pct}%'],
  'hw.media': ['media err {n}', '介质错误 {n}'],
  'hw.realloc': ['realloc {n}', '重映射 {n}'],
  'hw.pending': ['pending {n}', '待映射 {n}'],
  'hw.up': ['up', '已连接'],
  'hw.down': ['down', '断开'],

  // ---- tcping
  'tcping.title': ['TCPing latency · last 24h', 'TCPing 延迟 · 最近 24 小时'],
  'tcping.titleBase': ['TCPing latency', 'TCPing 延迟'],
  'tcping.span24h': ['last 24 h', '最近 24 小时'],
  'tcping.spanHours': ['last {n} h', '最近 {n} 小时'],
  'tcping.spanMinutes': ['last {n} min', '最近 {n} 分钟'],
  'tcping.latest': ['Now', '当前'],
  'tcping.avg': ['Average', '平均'],
  'tcping.loss': ['Packet loss', '丢包'],
  'tcping.allTargets': ['All targets', '全部目标'],
  'tcping.timeout': ['Timeout / failure', '超时 / 失败'],
  'tcping.notConfigured': ['TCPing is not configured.', '尚未配置 TCPing。'],
  'tcping.noData': ['No samples in the last 24 hours.', '最近 24 小时没有采样数据。'],
  'tcping.loadFailed': ['Could not load the chart library.', '图表库加载失败。'],

  // ---- admin
  'admin.title': ['Admin console', '管理面板'],
  'admin.subtitle': ['{n} servers · drag rows to reorder', '共 {n} 台服务器 · 拖动行可调整顺序'],
  'admin.subtitleTouch': ['{n} servers', '共 {n} 台服务器'],
  'admin.add': ['Add server', '添加服务器'],
  'admin.settings': ['Settings', '设置'],
  'admin.backup': ['Download backup', '下载备份'],
  'admin.backupFailed': ['Backup failed: {msg}', '下载备份失败：{msg}'],
  'admin.changePassword': ['Change password', '修改密码'],
  'admin.logout': ['Log out', '退出登录'],
  'admin.loading': ['Loading servers…', '加载中…'],
  'admin.empty.title': ['No servers yet', '还没有服务器'],
  'admin.empty.desc': ['Add a server, then install the agent with the copied command.', '先添加服务器，再用复制的命令安装探针。'],
  'admin.loadFailed': ['Failed to load servers', '加载服务器失败'],
  'admin.edit': ['Edit', '编辑'],
  'admin.copyLinux': ['Copy Linux / macOS install command', '复制 Linux / macOS 安装命令'],
  'admin.copyWindows': ['Copy Windows install command', '复制 Windows 安装命令'],
  'admin.copyIp': ['Copy {v}', '复制 {v}'],
  'admin.hiddenHome': ['Hidden on homepage', '首页隐藏'],
  'admin.tcpingOff': ['TCPing hidden', 'TCPing 已隐藏'],
  'admin.noAgent': ['Waiting for agent', '等待探针'],
  'admin.trafficIn': ['In', '接收'],
  'admin.trafficOut': ['Out', '发送'],
  'admin.orderSaveFailed': ['Failed to save order: {msg}', '保存顺序失败：{msg}'],
  'admin.orderSaved': ['Order saved', '顺序已保存'],
  'admin.dragHint': ['Drag to reorder', '拖动排序'],
  'admin.idLabel': ['ID', 'ID'],

  'admin.addModal.title': ['Add server', '添加服务器'],
  'admin.addModal.desc': ['A new server gets a numeric ID and the shared secret automatically.', '新服务器会自动分配数字 ID 与共享密钥。'],
  'admin.form.name': ['Display name', '显示名称'],
  'admin.form.namePlaceholder': ['e.g. Frankfurt · Storage 01', '例如：法兰克福 · 存储 01'],
  'admin.form.nameRequired': ['Name is required', '名称不能为空'],
  'admin.form.tags': ['Tags', '标签'],
  'admin.form.tagsHint': ['Comma-separated. Special: traffic:in, traffic:out, speed:in, speed:out show live values; spr:/spy:/spb: prefixes make red / gold / blue gradient badges.', '英文逗号分隔。特殊标签：traffic:in / traffic:out / speed:in / speed:out 显示实时数值；spr: / spy: / spb: 前缀生成红 / 金 / 蓝渐变徽章。'],
  'admin.form.showOnHome': ['Show on homepage', '首页展示'],
  'admin.form.showOnHomeDesc': ['When off, the public dashboard hides this server. API and admin still list it.', '关闭后公开面板不展示该服务器，API 与管理页仍可见。'],
  'admin.form.showTcping': ['Show TCPing', '展示 TCPing'],
  'admin.form.showTcpingDesc': ['When off, the TCPing tab is hidden for this server.', '关闭后该服务器的 TCPing 标签页将隐藏。'],
  'admin.form.note': ['IP, location, OS and metrics are reported by the agent and cannot be edited here.', 'IP、位置、系统与指标由探针上报，此处不可编辑。'],
  'admin.form.add': ['Add', '添加'],
  'admin.form.update': ['Save changes', '保存修改'],
  'admin.form.addFailed': ['Failed to add: {msg}', '添加失败：{msg}'],
  'admin.form.updateFailed': ['Failed to update: {msg}', '更新失败：{msg}'],
  'admin.editModal.title': ['Edit server', '编辑服务器'],
  'admin.deleteModal.title': ['Delete server', '删除服务器'],
  'admin.deleteModal.desc': ['Delete "{name}"? Its history and TCPing data will be removed. This cannot be undone.', '确定删除「{name}」？其历史与 TCPing 数据会一并删除，且无法恢复。'],
  'admin.deleteFailed': ['Failed to delete: {msg}', '删除失败：{msg}'],
  'admin.deleted': ['Server deleted', '服务器已删除'],
  'admin.added': ['Server added', '服务器已添加'],
  'admin.updated': ['Changes saved', '修改已保存'],

  'settings.title': ['Settings', '设置'],
  'settings.tab.general': ['General', '通用'],
  'settings.tab.display': ['Display', '显示'],
  'settings.tab.privacy': ['Privacy', '隐私'],
  'settings.tab.tcping': ['TCPing', 'TCPing'],
  'settings.navbarText': ['Site name', '站点名称'],
  'settings.navbarTextHint': ['Shown in the top bar and browser title. Empty = "Pulse".', '显示在顶栏与浏览器标题。留空则为 "Pulse"。'],
  'settings.navbarLogo': ['Logo', '图标'],
  'settings.navbarLogoHint': ['Image URL or inline SVG. Empty = built-in logo.', '图片地址或内联 SVG，留空使用默认图标。'],
  'settings.sharedSecret': ['Shared secret', '共享密钥'],
  'settings.sharedSecretHint': ['Every agent authenticates with this secret. Regenerating requires reinstalling agents.', '所有探针使用此密钥认证。重新生成后需重新配置探针。'],
  'settings.regenerate': ['Regenerate', '重新生成'],
  'settings.regenerated': ['New secret generated — click Save to apply.', '已生成新密钥，点击「保存」生效。'],
  'settings.regenerateTitle': ['Regenerate shared secret?', '重新生成共享密钥？'],
  'settings.regenerateDesc': ['All existing agents will stop reporting until they are reconfigured with the new secret.', '所有现有探针都会停止上报，直到使用新密钥重新配置。'],
  'settings.showTraffic': ['Show traffic totals', '显示流量统计'],
  'settings.showTrafficDesc': ['Show cumulative in / out traffic in the server detail dialog.', '在服务器详情弹窗中显示累计收发流量。'],
  'settings.glass': ['Glass effect', '毛玻璃效果'],
  'settings.glassDesc': ['Frosted-glass surfaces over a soft gradient background.', '在柔和渐变背景上使用磨砂玻璃质感。'],
  'settings.showCards': ['Show overview cards', '显示概览卡片'],
  'settings.showCardsDesc': ['The four summary tiles above the server list.', '服务器列表上方的四个汇总卡片。'],
  'settings.customCode': ['Custom CSS & JavaScript', '自定义 CSS 与 JavaScript'],
  'settings.customCodeHint': ['Applied to every page. Wrap CSS in <style> and JS in <script>. Scripts are served from this site; the content security policy blocks scripts loaded from other hosts.', '应用于所有页面。CSS 请放在 <style> 中，JS 放在 <script> 中。脚本由本站提供，内容安全策略会拦截从其他主机加载的脚本。'],
  'settings.customCodeWarn': ['Custom code is public — never include secrets or tokens.', '自定义代码对所有访客可见，请勿包含密钥或令牌。'],
  'settings.saved': ['Settings saved', '设置已保存'],
  'settings.saveFailed': ['Failed to save: {msg}', '保存失败：{msg}'],

  'privacy.enable': ['Privacy mode', '隐私模式'],
  'privacy.enableDesc': ['Visitors must log in (or use a share link) to see the dashboard.', '访客需要登录（或使用分享链接）才能查看面板。'],
  'privacy.share': ['Temporary share link', '临时分享链接'],
  'privacy.shareDesc': ['Grants read-only access without a password until it expires.', '在过期前允许免密只读访问。'],
  'privacy.current': ['Current link', '当前链接'],
  'privacy.expires': ['Expires {when}', '{when} 过期'],
  'privacy.expired': ['Expired', '已过期'],
  'privacy.estimated': ['(estimated, saved on Save)', '（预估，保存后生效）'],
  'privacy.hours': ['Valid for (hours)', '有效期（小时）'],
  'privacy.hoursHint': ['1 – 720 hours (30 days max).', '1 – 720 小时（最长 30 天）。'],
  'privacy.generate': ['Generate link', '生成链接'],
  'privacy.revoke': ['Revoke link', '撤销链接'],
  'privacy.invalidHours': ['Enter a value between 1 and 720 hours.', '请输入 1 到 720 之间的小时数。'],

  'tcping.interval': ['Polling interval', '探测间隔'],
  'tcping.intervalHint': ['How often each agent probes every target.', '每个探针探测所有目标的频率。'],
  'tcping.targets': ['Targets', '探测目标'],
  'tcping.targetName': ['Name', '名称'],
  'tcping.targetAddr': ['host:port', '主机:端口'],
  'tcping.addTarget': ['Add target', '添加目标'],
  'tcping.remove': ['Remove', '移除'],
  'tcping.targetsHint': ['Leave the list empty to disable TCPing.', '列表为空即关闭 TCPing。'],

  'password.title': ['Change password', '修改密码'],
  'password.current': ['Current password', '当前密码'],
  'password.new': ['New password', '新密码'],
  'password.confirm': ['Confirm new password', '确认新密码'],
  'password.minLength': ['At least 6 characters.', '至少 6 个字符。'],
  'password.fill': ['Please fill in all fields.', '请填写所有字段。'],
  'password.mismatch': ['New passwords do not match.', '两次输入的新密码不一致。'],
  'password.changed': ['Password changed', '密码已修改'],
  'password.failed': ['Failed to change password: {msg}', '修改密码失败：{msg}'],
  'password.submit': ['Change password', '修改密码'],

  // ---- login
  'login.title': ['Sign in', '登录'],
  'login.subtitle': ['Enter the admin password to continue.', '输入管理员密码以继续。'],
  'login.setupTitle': ['Create admin password', '设置管理员密码'],
  'login.setupSubtitle': ['First run — choose a password for the admin console.', '首次运行，请为管理面板设置密码。'],
  'login.password': ['Password', '密码'],
  'login.confirm': ['Confirm password', '确认密码'],
  'login.submit': ['Sign in', '登录'],
  'login.setupSubmit': ['Set password', '设置密码'],
  'login.invalid': ['Wrong password', '密码错误'],
  'login.mismatch': ['Passwords do not match', '两次密码不一致'],
  'login.tooShort': ['Password must be at least 6 characters', '密码至少 6 个字符'],
  'login.setupFailed': ['Could not set the password', '密码设置失败'],
  'login.show': ['Show password', '显示密码'],
  'login.hide': ['Hide password', '隐藏密码'],
  'login.back': ['Back to dashboard', '返回面板'],

  // ---- gate
  'gate.checking': ['Checking access…', '正在验证访问权限…'],
};

const KEY = 'preferred-language';
let current: Lang | null = null;

function systemLang(): Lang {
  try {
    const l = (navigator.language || (navigator.languages && navigator.languages[0]) || 'en').toLowerCase();
    return l.startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

export function getLang(): Lang {
  if (current) return current;
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch {}
  current = stored === 'zh' || stored === 'en' ? stored : systemLang();
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch {}
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  applyI18n(document);
  window.dispatchEvent(new CustomEvent('pulse:lang', { detail: { lang } }));
  // Legacy event name kept for operator custom_js hooks.
  window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
}

export function toggleLang(): void {
  setLang(getLang() === 'zh' ? 'en' : 'zh');
}

/** Translate `key`, substituting `{name}` placeholders from `vars`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = D[key];
  let s = entry ? (getLang() === 'zh' ? entry[1] : entry[0]) : key;
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  }
  return s;
}

/** Refresh every element carrying an i18n attribute under `root`. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    const v = t(key);
    el.setAttribute('title', v);
    el.setAttribute('aria-label', v);
  });
}

export function onLangChange(fn: (lang: Lang) => void): void {
  window.addEventListener('pulse:lang', (e: any) => fn(e.detail?.lang || getLang()));
}
