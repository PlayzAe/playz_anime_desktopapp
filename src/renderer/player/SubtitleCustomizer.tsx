import { Button, Segmented } from '../components/Controls';
import { Modal } from '../components/Modal';
import './subtitle-customizer.css';

export interface SubtitleStyle {
  size: 'small' | 'normal' | 'large' | 'huge';
  color: string;
  bg: 'shadow' | 'translucent' | 'solid' | 'none';
  font: 'sans' | 'rounded' | 'serif' | 'mono';
  raised: boolean;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: 'normal',
  color: '#ffffff',
  bg: 'translucent',
  font: 'sans',
  raised: false,
};

const STORAGE_KEY = 'playzanime:subtitle-style';

export function loadSubtitleStyle(): SubtitleStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SUBTITLE_STYLE, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SUBTITLE_STYLE;
}

export function saveSubtitleStyle(style: SubtitleStyle) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
  } catch {}
}

export function applySubtitleStyleToElement(el: HTMLElement, style: SubtitleStyle) {
  const SIZES = {
    small: 'clamp(13px, 1.8vw, 22px)',
    normal: 'clamp(16px, 2.3vw, 30px)',
    large: 'clamp(20px, 2.8vw, 36px)',
    huge: 'clamp(24px, 3.4vw, 44px)',
  };

  const SIZES_FS = {
    small: 'clamp(18px, 2.1vw, 32px)',
    normal: 'clamp(22px, 2.6vw, 42px)',
    large: 'clamp(26px, 3.2vw, 50px)',
    huge: 'clamp(32px, 4.0vw, 60px)',
  };

  const BGS = {
    shadow: { bg: 'transparent', shadow: '0 2px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)' },
    translucent: { bg: 'rgba(0, 0, 0, 0.65)', shadow: '0 1px 2px rgba(0,0,0,0.8)' },
    solid: { bg: 'rgba(0, 0, 0, 0.94)', shadow: 'none' },
    none: { bg: 'transparent', shadow: 'none' },
  };

  const FONTS = {
    sans: 'var(--font), "Segoe UI", "Noto Sans", sans-serif',
    rounded: '"Trebuchet MS", "Nunito", "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"Cascadia Code", "Consolas", monospace',
  };

  el.style.setProperty('--sub-size', SIZES[style.size] || SIZES.normal);
  el.style.setProperty('--sub-size-fs', SIZES_FS[style.size] || SIZES_FS.normal);
  el.style.setProperty('--sub-color', style.color || '#ffffff');
  el.style.setProperty('--sub-bg', BGS[style.bg]?.bg || BGS.translucent.bg);
  el.style.setProperty('--sub-shadow', BGS[style.bg]?.shadow || BGS.translucent.shadow);
  el.style.setProperty('--sub-font', FONTS[style.font] || FONTS.sans);
  el.style.setProperty('--sub-bottom', style.raised ? '13%' : '7%');
  el.style.setProperty('--sub-bottom-active', style.raised ? '128px' : '96px');
}

const COLOR_OPTIONS = [
  { label: 'White', value: '#ffffff' },
  { label: 'Yellow', value: '#facc15' },
  { label: 'Cyan', value: '#38bdf8' },
  { label: 'Green', value: '#4ade80' },
];

export function SubtitleCustomizerDialog({
  open,
  onClose,
  style,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  style: SubtitleStyle;
  onChange: (s: SubtitleStyle) => void;
}) {
  const update = (patch: Partial<SubtitleStyle>) => {
    const next = { ...style, ...patch };
    onChange(next);
    saveSubtitleStyle(next);
  };

  const handleReset = () => {
    onChange(DEFAULT_SUBTITLE_STYLE);
    saveSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
  };

  // Preview styling
  const previewBg =
    style.bg === 'solid'
      ? 'rgba(0, 0, 0, 0.94)'
      : style.bg === 'translucent'
        ? 'rgba(0, 0, 0, 0.65)'
        : 'transparent';

  const previewShadow =
    style.bg === 'shadow'
      ? '0 2px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)'
      : style.bg === 'translucent'
        ? '0 1px 2px rgba(0,0,0,0.8)'
        : 'none';

  const previewFont =
    style.font === 'rounded'
      ? '"Trebuchet MS", sans-serif'
      : style.font === 'serif'
        ? 'Georgia, serif'
        : style.font === 'mono'
          ? 'monospace'
          : 'sans-serif';

  const previewScale =
    style.size === 'small'
      ? '0.85em'
      : style.size === 'large'
        ? '1.2em'
        : style.size === 'huge'
          ? '1.4em'
          : '1em';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Subtitle Appearance"
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <Button variant="quiet" onClick={handleReset}>
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="sub-customizer-container">
        {/* Live Preview Box */}
        <div className="sub-preview-box">
          <div className="sub-preview-scene">
            <span
              className="sub-preview-text"
              style={{
                color: style.color,
                background: previewBg,
                textShadow: previewShadow,
                fontFamily: previewFont,
                fontSize: previewScale,
              }}
            >
              I became a war hero, but that was only the prologue.
            </span>
          </div>
        </div>

        {/* Font Size */}
        <div className="sub-field">
          <span className="sub-field-label">Font Size</span>
          <Segmented
            label="Font Size"
            value={style.size}
            onChange={(size) => update({ size })}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'normal', label: 'Normal' },
              { value: 'large', label: 'Large' },
              { value: 'huge', label: 'Huge' },
            ]}
          />
        </div>

        {/* Color Palette */}
        <div className="sub-field">
          <span className="sub-field-label">Text Color</span>
          <div className="sub-color-row">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`sub-color-pill ${style.color === c.value ? 'is-selected' : ''}`}
                style={{ ['--swatch' as string]: c.value }}
                onClick={() => update({ color: c.value })}
              >
                <span className="color-swatch" style={{ background: c.value }} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Background / Shadow Style */}
        <div className="sub-field">
          <span className="sub-field-label">Background & Outline</span>
          <Segmented
            label="Background Style"
            value={style.bg}
            onChange={(bg) => update({ bg })}
            options={[
              { value: 'translucent', label: 'Box (60%)' },
              { value: 'solid', label: 'Solid Box' },
              { value: 'shadow', label: 'Outline Only' },
              { value: 'none', label: 'Plain' },
            ]}
          />
        </div>

        {/* Font Family */}
        <div className="sub-field">
          <span className="sub-field-label">Font Style</span>
          <Segmented
            label="Font Family"
            value={style.font}
            onChange={(font) => update({ font })}
            options={[
              { value: 'sans', label: 'Modern Sans' },
              { value: 'rounded', label: 'Rounded' },
              { value: 'serif', label: 'Serif' },
              { value: 'mono', label: 'Mono' },
            ]}
          />
        </div>

        {/* Vertical Offset */}
        <div className="sub-field">
          <span className="sub-field-label">Vertical Position</span>
          <Segmented
            label="Position"
            value={style.raised ? 'raised' : 'standard'}
            onChange={(v) => update({ raised: v === 'raised' })}
            options={[
              { value: 'standard', label: 'Bottom (Standard)' },
              { value: 'raised', label: 'Raised (Clear lower-thirds)' },
            ]}
          />
        </div>
      </div>
    </Modal>
  );
}
