import { Platform } from 'react-native';

export const theme = {
  colors: {
    bgViewport: '#f8fafc',
    panelBg: 'rgba(255, 255, 255, 0.94)',
    panelSubtle: '#f8fafc',
    panelBorder: '#e2e8f0',
    cardBg: '#ffffff',
    cardBorder: 'rgba(0, 0, 0, 0.07)',

    // Primary Brand & Navigation Blues
    brandBlue: '#1d4ed8',
    idrBlue: '#2563eb',
    idrBgSoft: '#eff6ff',
    idrBorder: '#bfdbfe',

    // GNSS Emerald Greens
    gnssEmerald: '#059669',
    gnssEmeraldDark: '#047857',
    gnssBgSoft: '#ecfdf5',
    gnssBorder: '#a7f3d0',

    // Alerts & Warnings
    alertAmber: '#d97706',
    alertAmberBg: '#fef3c7',
    alertAmberBorder: '#fde68a',
    alertRed: '#dc2626',
    alertRose: '#e11d48',
    alertRoseBg: '#fff1f2',
    alertRoseBorder: '#fecdd3',

    // Ghost Baseline Raw INS
    rawGhostOrange: '#f97316',
    rawGhostOrangeBg: '#fff7ed',

    // Typography & Neutrals
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    textDim: '#94a3b8',

    borderLight: '#e2e8f0',
    slateDark: '#0f172a',
    white: '#ffffff',
    black: '#000000',
  },
  typography: {
    fontUi: Platform.OS === 'ios' ? 'System' : 'Roboto',
    fontMono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  shadows: {
    card: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 4,
    },
    floating: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 8,
    },
    subtle: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 3,
      elevation: 2,
    },
  },
};
