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
};

export type Dictionary = typeof en;
