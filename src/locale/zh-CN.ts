const zhCN = {
  'minecraft-bridge': {
    common: {
      unknownGroup: '未知群组',
      unknownServer: '未知服务器',
      unknownUser: '未知用户',
      unknownPlayer: '未知玩家',
    },
    event: {
      playerJoin: '{0} 加入了游戏',
      playerQuit: '{0} 退出了游戏',
      playerDeathFallback: '{0} 死亡了',
      playerCommand: '{0} 使用命令 {1}',
      playerAchievement: '{0} 达成了进度 {1}',
      playerChat: '{0} {1} {2}',
      serverPrefix: '[{0}] {1}',
    },
    message: {
      noServerAvailable: '没有可用的目标服务器。',
      noPermission: '你没有权限执行该命令。',
      imageTag: '图片',
      imageHover: '点击跳转至浏览器查看',
      commandInputRequired: '请输入要执行的命令',
      commandSendFailed: '向 {0} 发送命令失败：{1}',
      statusHeader: '当前连接状态：',
      statusServerName: '- 服务器名称：{0}',
      statusConnection: '- 连接状态：{0}',
      statusConnected: '已连接',
      statusDisconnected: '未连接',
      statusFailed: '查询失败，请检查配置。',
      reconnectNoPermission: '权限不足，仅管理员可用。',
      reconnectStarting: '正在重连全部服务器，请稍候...',
      reconnectDone: '重连完成，当前已连接：{0}',
      reconnectDoneEmpty: '重连完成，当前没有可用连接。',
      reconnectFailed: '重连失败：{0}',
      invalidCommandArgs: '命令参数解析失败，请检查输入格式。',
      groupApi: {
        titleRequired: '请输入要发送的标题内容',
        subtitleRequired: '请输入要发送的副标题内容',
        actionbarRequired: '请输入要发送的动作栏内容',
        privateFormat: '请输入正确的私聊格式: {0}mcp <玩家> <内容>',
      },
      rconSuccess: '命令执行成功',
      rconFailed: '命令执行失败 ({0})',
    },
  },
}

export default zhCN
