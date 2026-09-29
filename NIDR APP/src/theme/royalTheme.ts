/**
 * NaviSense IDR - Premium Royal Luxury Theme
 *
 * White & Imperial Royal Gold Design System.
 * Pristine white canvas, regal midnight typography, and imperial gold accents.
 * Strictly zero emojis.
 */

export const RoyalTheme = {
  colors: {
    // Base Surfaces
    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceSubtle: '#F1F5F9',
    surfaceTint: '#FDFBF7',
    surfaceInset: '#F8F9FA',
    modalOverlay: 'rgba(15, 23, 42, 0.45)',

    // Imperial Royal Gold Accents
    gold: '#B8860B',             // Pure Imperial Gold
    goldLight: '#D4AF37',        // Radiant Gold
    goldDark: '#855E15',         // High-contrast Gold for text on white
    goldMuted: '#C5A059',        // Champagne Gold
    goldBg: '#FDFBF7',           // Luxurious subtle champagne background
    goldBgSoft: 'rgba(184, 134, 11, 0.09)',
    goldBorder: '#DFD0B8',       // Refined gold hairline border
    goldBorderGlow: '#B8860B',

    // Regal Slate & Typography
    textPrimary: '#0F172A',      // Regal Midnight Charcoal
    textSecondary: '#334155',    // Refined Slate
    textTertiary: '#64748B',     // Muted Charcoal
    textMuted: '#94A3B8',        // Subtle Note Gray
    textGold: '#855E15',         // Legible Rich Gold Text
    textWhite: '#FFFFFF',

    // Borders & Dividers
    border: '#E2E8F0',
    borderSubtle: '#F1F5F9',
    borderStrong: '#CBD5E1',

    // Status Colors (Regal Jewels)
    emerald: '#047857',          // Imperial Emerald
    emeraldBg: '#ECFDF5',
    emeraldBorder: '#A7F3D0',

    amber: '#B45309',            // Imperial Amber
    amberBg: '#FFFBEB',
    amberBorder: '#FDE68A',

    ruby: '#991B1B',             // Imperial Ruby
    rubyBg: '#FEF2F2',
    rubyBorder: '#FECACA',

    // Bottom Navigation Bar
    tabBarBg: '#FFFFFF',
    tabBarBorder: '#E2E8F0',
    tabActive: '#B8860B',
    tabInactive: '#64748B',

    // Map Styling (White Luxury Cartography)
    mapCanvas: '#F3F4F6',
    mapGrid: '#E5E7EB',
    mapRoad: '#FFFFFF',
    mapRoadBorder: '#E2E8F0',
    mapRoute: '#B8860B',
    mapRouteSecondary: '#D4AF37',
    mapPuckBg: '#0F172A',
    mapPuckBorder: '#B8860B',
    mapUncertaintyBg: 'rgba(184, 134, 11, 0.12)',
    mapUncertaintyBorder: 'rgba(184, 134, 11, 0.40)',
  },

  shadows: {
    card: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    floating: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 6,
    },
    goldGlow: {
      shadowColor: '#B8860B',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
  },
};
