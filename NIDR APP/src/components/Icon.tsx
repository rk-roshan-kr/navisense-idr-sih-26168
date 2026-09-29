import React from 'react';
import { View } from 'react-native';

export interface IconProps {
  size?: number;
  color?: string;
  fill?: string;
}

// 1. CircleDot (Target / Center point)
export const CircleDot: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const outerSize = size;
  const innerSize = Math.max(4, Math.round(size * 0.38));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
};

// 2. Play (Start recording / run)
export const Play: React.FC<IconProps> = ({ size = 18, color = '#10B981' }) => {
  const w = Math.round(size * 0.65);
  const h = Math.round(size * 0.8);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: w,
          borderTopWidth: h / 2,
          borderBottomWidth: h / 2,
          borderLeftColor: color,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          marginLeft: Math.round(size * 0.12),
        }}
      />
    </View>
  );
};

// 3. Square (Stop recording / freeze)
export const Square: React.FC<IconProps> = ({ size = 18, color = '#EF4444', fill }) => {
  const s = Math.round(size * 0.68);
  const c = fill || color;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: s,
          height: s,
          backgroundColor: c,
          borderRadius: 2,
        }}
      />
    </View>
  );
};

// 4. User (Participant / Operator)
export const User: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const headSize = Math.round(size * 0.38);
  const bodyW = Math.round(size * 0.76);
  const bodyH = Math.round(size * 0.38);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: headSize,
          height: headSize,
          borderRadius: headSize / 2,
          borderWidth: 1.5,
          borderColor: color,
          marginBottom: 1,
        }}
      />
      <View
        style={{
          width: bodyW,
          height: bodyH,
          borderTopLeftRadius: bodyW / 2,
          borderTopRightRadius: bodyW / 2,
          borderWidth: 1.5,
          borderColor: color,
          borderBottomWidth: 0,
        }}
      />
    </View>
  );
};

// 5. Zap (Hardware rate / sensor live pulse)
export const Zap: React.FC<IconProps> = ({ size = 18, color = '#F59E0B' }) => {
  const stroke = 1.6;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.14,
          left: size * 0.3,
          width: size * 0.42,
          height: stroke,
          backgroundColor: color,
          transform: [{ rotate: '-55deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.46,
          left: size * 0.22,
          width: size * 0.38,
          height: stroke,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.14,
          right: size * 0.3,
          width: size * 0.42,
          height: stroke,
          backgroundColor: color,
          transform: [{ rotate: '-55deg' }],
        }}
      />
    </View>
  );
};

// 6. Compass (Azimuth / Navigation / Test IDR)
export const Compass: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const needleSize = Math.round(size * 0.42);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: needleSize,
            height: needleSize,
            transform: [{ rotate: '45deg' }],
            borderWidth: 1.5,
            borderColor: color,
            backgroundColor: 'transparent',
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: 3,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
};

// 7. Lock (Anchor freeze / acquisition)
export const Lock: React.FC<IconProps> = ({ size = 18, color = '#10B981' }) => {
  const bodyW = Math.round(size * 0.7);
  const bodyH = Math.round(size * 0.48);
  const shackleW = Math.round(size * 0.44);
  const shackleH = Math.round(size * 0.38);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: shackleW,
          height: shackleH,
          borderTopLeftRadius: shackleW / 2,
          borderTopRightRadius: shackleW / 2,
          borderWidth: 1.5,
          borderColor: color,
          borderBottomWidth: 0,
          marginBottom: -1,
        }}
      />
      <View
        style={{
          width: bodyW,
          height: bodyH,
          borderRadius: 2.5,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: 1.8, height: 3.5, backgroundColor: color }} />
      </View>
    </View>
  );
};

// 8. Radio (Satellite / GNSS carrier / Signal broadcast)
export const Radio: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.08,
          width: size * 0.88,
          height: size * 0.88,
          borderRadius: (size * 0.88) / 2,
          borderWidth: 1.5,
          borderColor: color,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.28,
          width: size * 0.54,
          height: size * 0.54,
          borderRadius: (size * 0.54) / 2,
          borderWidth: 1.5,
          borderColor: color,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.16,
          width: Math.max(3, Math.round(size * 0.2)),
          height: Math.max(3, Math.round(size * 0.2)),
          borderRadius: size * 0.1,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.04,
          width: 1.5,
          height: size * 0.16,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

// 9. RotateCcw (Reset test / counter-clockwise loop)
export const RotateCcw: React.FC<IconProps> = ({ size = 18, color = '#CBD5E1' }) => {
  const r = Math.round(size * 0.74);
  const arrowSize = Math.max(3, Math.round(size * 0.22));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: r,
          height: r,
          borderRadius: r / 2,
          borderWidth: 1.5,
          borderColor: color,
          borderTopColor: 'transparent',
          transform: [{ rotate: '-35deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.12,
          left: size * 0.16,
          width: 0,
          height: 0,
          borderRightWidth: arrowSize,
          borderTopWidth: arrowSize / 2,
          borderBottomWidth: arrowSize / 2,
          borderRightColor: color,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
    </View>
  );
};

// 10. RefreshCw (Reload sessions / clockwise loop)
export const RefreshCw: React.FC<IconProps> = ({ size = 18, color = '#94A3B8' }) => {
  const r = Math.round(size * 0.74);
  const arrowSize = Math.max(3, Math.round(size * 0.22));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: r,
          height: r,
          borderRadius: r / 2,
          borderWidth: 1.5,
          borderColor: color,
          borderTopColor: 'transparent',
          transform: [{ rotate: '35deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.12,
          right: size * 0.16,
          width: 0,
          height: 0,
          borderLeftWidth: arrowSize,
          borderTopWidth: arrowSize / 2,
          borderBottomWidth: arrowSize / 2,
          borderLeftColor: color,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
    </View>
  );
};

// 11. ShieldAlert (Outage active warning)
export const ShieldAlert: React.FC<IconProps> = ({ size = 18, color = '#F59E0B' }) => {
  const w = Math.round(size * 0.75);
  const h = Math.round(size * 0.88);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w,
          height: h,
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          borderBottomLeftRadius: w / 2,
          borderBottomRightRadius: w / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: 1.5, height: h * 0.35, backgroundColor: color, marginBottom: 2 }} />
        <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: color }} />
      </View>
    </View>
  );
};

// 12. ShieldCheck (GNSS healthy / verified)
export const ShieldCheck: React.FC<IconProps> = ({ size = 18, color = '#10B981' }) => {
  const w = Math.round(size * 0.75);
  const h = Math.round(size * 0.88);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w,
          height: h,
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          borderBottomLeftRadius: w / 2,
          borderBottomRightRadius: w / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: w * 0.44,
            height: h * 0.22,
            borderLeftWidth: 1.8,
            borderBottomWidth: 1.8,
            borderColor: color,
            transform: [{ rotate: '-45deg' }],
            marginTop: -h * 0.08,
          }}
        />
      </View>
    </View>
  );
};

// 13. AlertTriangle (Warning / Caution)
export const AlertTriangle: React.FC<IconProps> = ({ size = 18, color = '#F59E0B' }) => {
  const w = Math.round(size * 0.9);
  const h = Math.round(size * 0.8);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderBottomWidth: h,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          alignItems: 'center',
        }}>
        <View
          style={{
            position: 'absolute',
            top: h * 0.36,
            width: 1.8,
            height: h * 0.28,
            backgroundColor: '#FFFFFF',
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: h * 0.72,
            width: 2,
            height: 2,
            borderRadius: 1,
            backgroundColor: '#FFFFFF',
          }}
        />
      </View>
    </View>
  );
};

// 14. FolderArchive (Sessions tab / archive catalog)
export const FolderArchive: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const w = Math.round(size * 0.85);
  const h = Math.round(size * 0.62);
  const tabW = Math.round(w * 0.44);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: tabW,
          height: Math.max(3, Math.round(size * 0.16)),
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          backgroundColor: color,
          alignSelf: 'flex-start',
          marginLeft: (size - w) / 2,
        }}
      />
      <View
        style={{
          width: w,
          height: h,
          borderRadius: 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: w * 0.5, height: 1.5, backgroundColor: color }} />
      </View>
    </View>
  );
};

// 15. Database (Collect tab / dataset storage)
export const Database: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const w = Math.round(size * 0.78);
  const diskH = Math.max(3, Math.round(size * 0.22));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 1 }}>
      <View style={{ width: w, height: diskH, borderRadius: diskH / 2, borderWidth: 1.5, borderColor: color }} />
      <View style={{ width: w, height: diskH, borderRadius: diskH / 2, borderWidth: 1.5, borderColor: color }} />
      <View style={{ width: w, height: diskH, borderRadius: diskH / 2, borderWidth: 1.5, borderColor: color }} />
    </View>
  );
};

// 16. Archive (Package storage)
export const Archive: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const w = Math.round(size * 0.8);
  const h = Math.round(size * 0.7);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w,
          height: Math.round(h * 0.32),
          borderRadius: 2,
          borderWidth: 1.5,
          borderColor: color,
          marginBottom: 1,
        }}
      />
      <View
        style={{
          width: w * 0.88,
          height: Math.round(h * 0.65),
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: w * 0.35, height: 1.5, backgroundColor: color }} />
      </View>
    </View>
  );
};

// 17. Trash2 (Delete action)
export const Trash2: React.FC<IconProps> = ({ size = 18, color = '#EF4444' }) => {
  const w = Math.round(size * 0.66);
  const h = Math.round(size * 0.62);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: Math.round(w * 0.4),
          height: 2,
          backgroundColor: color,
          borderTopLeftRadius: 1,
          borderTopRightRadius: 1,
          marginBottom: 1,
        }}
      />
      <View style={{ width: Math.round(size * 0.82), height: 1.5, backgroundColor: color, marginBottom: 1 }} />
      <View
        style={{
          width: w,
          height: h,
          borderBottomLeftRadius: 3,
          borderBottomRightRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          borderTopWidth: 0,
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          paddingVertical: 2,
        }}>
        <View style={{ width: 1.2, height: '80%', backgroundColor: color }} />
        <View style={{ width: 1.2, height: '80%', backgroundColor: color }} />
      </View>
    </View>
  );
};

// 18. BarChart2 (Comparison stats / metrics)
export const BarChart2: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const colW = Math.max(2, Math.round(size * 0.18));
  return (
    <View
      style={{
        width: size,
        height: size,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: Math.round(size * 0.12),
        paddingBottom: Math.round(size * 0.12),
      }}>
      <View style={{ width: colW, height: size * 0.4, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: colW, height: size * 0.8, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: colW, height: size * 0.55, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
};

// 19. GitCompare (Dual session trajectory comparison)
export const GitCompare: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const dotSize = Math.max(4, Math.round(size * 0.28));
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.12,
          left: size * 0.15,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.38,
          left: size * 0.25,
          width: 1.5,
          height: size * 0.4,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.12,
          right: size * 0.15,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.38,
          right: size * 0.25,
          width: 1.5,
          height: size * 0.4,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: size * 0.5,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '-35deg' }],
        }}
      />
    </View>
  );
};

// 20. Layers (Overlay layers / session stacking)
export const Layers: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const w = Math.round(size * 0.74);
  const h = Math.max(3, Math.round(size * 0.26));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w,
          height: h,
          borderWidth: 1.5,
          borderColor: color,
          borderRadius: 2,
          transform: [{ skewX: '-25deg' }],
          marginBottom: 3,
        }}
      />
      <View
        style={{
          width: w,
          height: h,
          borderWidth: 1.5,
          borderColor: color,
          borderRadius: 2,
          transform: [{ skewX: '-25deg' }],
        }}
      />
    </View>
  );
};

// 21. Activity (Waveform / live acquisition signal)
export const Activity: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', left: 0, width: size * 0.25, height: 1.5, backgroundColor: color }} />
      <View
        style={{
          position: 'absolute',
          left: size * 0.22,
          top: size * 0.18,
          width: size * 0.35,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '-65deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.42,
          top: size * 0.46,
          width: size * 0.45,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '60deg' }],
        }}
      />
      <View style={{ position: 'absolute', right: 0, width: size * 0.25, height: 1.5, backgroundColor: color }} />
    </View>
  );
};

// 22. CheckCircle2 (Validation pass)
export const CheckCircle2: React.FC<IconProps> = ({ size = 18, color = '#10B981' }) => {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: size * 0.44,
          height: size * 0.24,
          borderLeftWidth: 1.8,
          borderBottomWidth: 1.8,
          borderColor: color,
          transform: [{ rotate: '-45deg' }],
          marginTop: -size * 0.08,
        }}
      />
    </View>
  );
};

// 23. XCircle (Validation fail)
export const XCircle: React.FC<IconProps> = ({ size = 18, color = '#EF4444' }) => {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: size * 0.45,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
          position: 'absolute',
        }}
      />
      <View
        style={{
          width: size * 0.45,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
          position: 'absolute',
        }}
      />
    </View>
  );
};

// 24. MapPin (Anchor location coordinate)
export const MapPin: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const pinHead = Math.round(size * 0.58);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: pinHead,
          height: pinHead,
          borderRadius: pinHead / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: Math.max(3, Math.round(pinHead * 0.36)),
            height: Math.max(3, Math.round(pinHead * 0.36)),
            borderRadius: pinHead * 0.18,
            backgroundColor: color,
          }}
        />
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: pinHead * 0.28,
          borderRightWidth: pinHead * 0.28,
          borderTopWidth: size * 0.28,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
          marginTop: -1.5,
        }}
      />
    </View>
  );
};

// 25. Navigation (Bearing heading pointer)
export const Navigation: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: Math.round(size * 0.35),
        borderRightWidth: Math.round(size * 0.35),
        borderBottomWidth: Math.round(size * 0.78),
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: color,
      }}
    />
  </View>
);

// 26. Gauge (Speedometer)
export const Gauge: React.FC<IconProps> = ({ size = 18, color = '#94A3B8' }) => {
  const r = Math.round(size * 0.85);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: r,
          height: r,
          borderRadius: r / 2,
          borderWidth: 1.5,
          borderColor: color,
          borderBottomColor: 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            position: 'absolute',
            bottom: r * 0.25,
            width: 1.5,
            height: r * 0.36,
            backgroundColor: color,
            transform: [{ rotate: '35deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: r * 0.22,
            width: 3,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
};

// 27. Milestone (Distance waypoint flag)
export const Milestone: React.FC<IconProps> = ({ size = 18, color = '#94A3B8' }) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}>
    <View style={{ width: 1.8, height: size * 0.85, backgroundColor: color }} />
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: size * 0.24,
        borderBottomWidth: size * 0.24,
        borderLeftWidth: size * 0.44,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: color,
        alignSelf: 'flex-start',
        marginTop: size * 0.08,
      }}
    />
  </View>
);

// 28. TrendingUp (Error rate / drift percentage)
export const TrendingUp: React.FC<IconProps> = ({ size = 18, color = '#10B981' }) => {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          width: size * 0.68,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '-35deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.18,
          right: size * 0.16,
          width: size * 0.28,
          height: size * 0.28,
          borderTopWidth: 1.8,
          borderRightWidth: 1.8,
          borderColor: color,
        }}
      />
    </View>
  );
};

// 29. Share2 (Send archive to Drive / WhatsApp / QuickShare)
export const Share2: React.FC<IconProps> = ({ size = 18, color = '#10B981' }) => {
  const dotSize = Math.max(3, Math.round(size * 0.24));
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.1,
          right: size * 0.12,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.38,
          left: size * 0.12,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.1,
          right: size * 0.12,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.28,
          left: size * 0.26,
          width: size * 0.44,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '-28deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.28,
          left: size * 0.26,
          width: size * 0.44,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '28deg' }],
        }}
      />
    </View>
  );
};

// 30. Download (Export ZIP / Save file)
export const Download: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  const arrowHead = Math.round(size * 0.22);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 1.8, height: size * 0.42, backgroundColor: color, marginTop: 1 }} />
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: arrowHead,
          borderRightWidth: arrowHead,
          borderTopWidth: arrowHead,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }}
      />
      <View
        style={{
          width: Math.round(size * 0.74),
          height: Math.round(size * 0.2),
          borderBottomWidth: 1.5,
          borderLeftWidth: 1.5,
          borderRightWidth: 1.5,
          borderColor: color,
          borderRadius: 1,
          marginTop: 2,
        }}
      />
    </View>
  );
};

// 39. Crosshair (Center / Target)
export const Crosshair: React.FC<IconProps> = ({ size = 18, color = '#B8860B' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.7,
          height: size * 0.7,
          borderRadius: (size * 0.7) / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View style={{ position: 'absolute', width: size, height: 1.2, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: 1.2, height: size, backgroundColor: color }} />
    </View>
  );
};

// 40. ZoomIn
export const ZoomIn: React.FC<IconProps> = ({ size = 18, color = '#CBD5E1' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: (size * 0.6) / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: size * 0.35, height: 1.5, backgroundColor: color }} />
        <View style={{ position: 'absolute', width: 1.5, height: size * 0.35, backgroundColor: color }} />
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: 1,
          right: 1,
          width: size * 0.3,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

// 41. ZoomOut
export const ZoomOut: React.FC<IconProps> = ({ size = 18, color = '#CBD5E1' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: (size * 0.6) / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: size * 0.35, height: 1.5, backgroundColor: color }} />
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: 1,
          right: 1,
          width: size * 0.3,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

// 42. Cpu (Model / Processor)
export const Cpu: React.FC<IconProps> = ({ size = 18, color = '#A855F7' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.65,
          height: size * 0.65,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: size * 0.28, height: size * 0.28, backgroundColor: color, borderRadius: 1 }} />
      </View>
    </View>
  );
};

// 43. Settings (Gear / Controls)
export const Settings: React.FC<IconProps> = ({ size = 18, color = '#94A3B8' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.65,
          height: size * 0.65,
          borderRadius: (size * 0.65) / 2,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      <View style={{ position: 'absolute', width: size * 0.85, height: 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: 2, height: size * 0.85, backgroundColor: color }} />
    </View>
  );
};

// 44. CheckCircle
export const CheckCircle: React.FC<IconProps> = ({ size = 18, color = '#10B981' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: size * 0.45,
            height: size * 0.24,
            borderBottomWidth: 1.8,
            borderLeftWidth: 1.8,
            borderColor: color,
            transform: [{ rotate: '-45deg' }],
            marginBottom: 2,
          }}
        />
      </View>
    </View>
  );
};

// 45. Search
export const Search: React.FC<IconProps> = ({ size = 18, color = '#0F172A' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.65,
          height: size * 0.65,
          borderRadius: (size * 0.65) / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 1,
          right: 1,
          width: size * 0.35,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

// 46. X (Close / Cancel)
export const X: React.FC<IconProps> = ({ size = 18, color = '#0F172A' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size * 0.7,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.7,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
};


