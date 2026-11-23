export const en = {
  common: {
    appName: 'Electricity Monitor',
    greeting: 'Hello, {{name}}',
  },
  email: {
    footer: "If you didn't request this, ignore this email.",
    verifyEmail: {
      subject: 'Confirm your email',
      intro: 'Hi {{name}}, confirm your email address for Electricity Monitor.',
      action: 'Confirm email',
      expiry: 'This link is valid for 24 hours.',
    },
    resetPassword: {
      subject: 'Reset your password',
      intro: 'Hi {{name}}, we received a request to reset your Electricity Monitor password.',
      action: 'Reset password',
      expiry: 'This link is valid for 1 hour.',
    },
    accountExists: {
      subject: 'Your account already exists',
      intro:
        'Hi {{name}}, someone tried to create an Electricity Monitor account with this email address, but you already have one. If you forgot your password, reset it on the login page.',
      action: 'Log in',
    },
  },
  telegram: {
    duration: {
      seconds: '{{value}} s',
      minutes: '{{value}} min',
      hours: '{{value}} h',
      days: '{{value}} d',
    },
    offline: {
      title: '🔴 {{name}} — device stopped checking in',
      body: 'Last signal: {{time}}',
    },
    recovery: {
      title: '🟢 {{name}} — device is back online',
      body: 'Offline for {{duration}} ({{range}})',
    },
    summary: {
      title: '🟠 {{name}} — device was out of contact',
    },
    powerBlip: {
      titleShort: '🟡 {{name}} — suspected short power interruption',
      titleLong: '🟡 {{name}} — suspected power interruption',
      body: 'Device restarted · {{duration}} between check-ins',
    },
    cause: {
      POWER: 'suspected power outage',
      NETWORK: 'suspected network outage',
    },
    bot: {
      welcome:
        '👋 Hi! To get power alerts here, open the Electricity Monitor app, choose “Connect Telegram” and follow the link.',
      linked: '✅ Done! This chat is linked and will get alerts for your devices.',
      alreadyLinked: 'This chat is already linked to your account.',
      linkExpired: 'This link has expired or was already used. Create a new one in the app.',
      status: {
        ONLINE: '🟢 {{name}} — online since {{time}}',
        OFFLINE: '🔴 {{name}} — offline since {{time}}',
        PENDING: '⚪ {{name}} — waiting for the first check-in',
        UPDATING: '🔄 {{name}} — updating since {{time}}',
      },
      statusEmpty: 'No devices send alerts to this chat yet. Choose them in the app.',
      stopped: "🛑 This chat is unlinked. You won't get alerts here anymore.",
      notLinked: "This chat isn't linked yet. Open the app and choose “Connect Telegram”.",
      help: 'Commands:\n/status — your devices\n/stop — unlink this chat',
    },
  },
};

export type Dictionary = typeof en;
