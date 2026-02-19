const enUS = {
  'minecraft-bridge': {
    common: {
      unknownGroup: 'Unknown group',
      unknownServer: 'Unknown server',
      unknownUser: 'Unknown user',
      unknownPlayer: 'Unknown player',
    },
    event: {
      playerJoin: '{0} joined the game',
      playerQuit: '{0} left the game',
      playerDeathFallback: '{0} died',
      playerCommand: '{0} used command {1}',
      playerAchievement: '{0} completed advancement {1}',
      playerChat: '{0} {1} {2}',
      serverPrefix: '[{0}] {1}',
    },
    message: {
      noServerAvailable: 'No available target server.',
      noPermission: 'You are not allowed to run this command.',
      imageTag: 'image',
      imageHover: 'Click to open in browser',
      commandInputRequired: 'Please enter a command to run.',
      commandSendFailed: 'Failed to send command to {0}: {1}',
      statusHeader: 'Current connection status:',
      statusServerName: '- Server name: {0}',
      statusConnection: '- Connection: {0}',
      statusConnected: 'connected',
      statusDisconnected: 'disconnected',
      statusFailed: 'Query failed. Please check your configuration.',
      reconnectNoPermission: 'Insufficient permission. Admin only.',
      reconnectStarting: 'Reconnecting all servers, please wait...',
      reconnectDone: 'Reconnect completed, connected: {0}',
      reconnectDoneEmpty: 'Reconnect completed, no available connections.',
      reconnectFailed: 'Reconnect failed: {0}',
      invalidCommandArgs: 'Failed to parse command arguments. Please check the input format.',
      groupApi: {
        titleRequired: 'Please enter the title content.',
        subtitleRequired: 'Please enter the subtitle content.',
        actionbarRequired: 'Please enter the actionbar content.',
        privateFormat: 'Please use the correct format: {0}mcp <player> <content>',
      },
      rconSuccess: 'Command executed successfully',
      rconFailed: 'Command failed ({0})',
    },
  },
}

export default enUS
