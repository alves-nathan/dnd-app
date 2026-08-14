import { useColorScheme } from 'react-native';

export const lightColors = {
  primary: '#7A1F3D',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFD9E3',
  onPrimaryContainer: '#3F001B',
  secondary: '#765A00',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFE17A',
  onSecondaryContainer: '#251A00',
  tertiary: '#315E7D',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#CEE5FF',
  onTertiaryContainer: '#001D32',
  background: '#FFF8F7',
  surface: '#FFF8F7',
  surfaceContainerLow: '#FFF0F1',
  surfaceContainer: '#F9E9EB',
  surfaceContainerHigh: '#F3E3E5',
  onSurface: '#211A1C',
  onSurfaceVariant: '#514347',
  outline: '#847377',
  outlineVariant: '#D7C1C6',
  success: '#256A45',
  successContainer: '#A8F2C2',
  warning: '#7B5800',
  warningContainer: '#FFE08A',
  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  scrim: '#000000'
} as const;

export const darkColors = {
  primary: '#FFB0C8',
  onPrimary: '#64002F',
  primaryContainer: '#8B2850',
  onPrimaryContainer: '#FFD9E3',
  secondary: '#E9C44B',
  onSecondary: '#3D2E00',
  secondaryContainer: '#574500',
  onSecondaryContainer: '#FFE17A',
  tertiary: '#9CCBEE',
  onTertiary: '#003351',
  tertiaryContainer: '#184A69',
  onTertiaryContainer: '#CEE5FF',
  background: '#191113',
  surface: '#191113',
  surfaceContainerLow: '#21191B',
  surfaceContainer: '#261D20',
  surfaceContainerHigh: '#31282A',
  onSurface: '#F0DEE1',
  onSurfaceVariant: '#D7C1C6',
  outline: '#A18C91',
  outlineVariant: '#514347',
  success: '#8DD7A7',
  successContainer: '#0A4F31',
  warning: '#EBC34A',
  warningContainer: '#5B4300',
  error: '#FFB4AB',
  errorContainer: '#93000A',
  scrim: '#000000'
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  full: 999
} as const;

export const typography = {
  display: { fontSize: 36, lineHeight: 42, fontWeight: '800' as const, letterSpacing: -0.7 },
  headline: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.35 },
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: '800' as const },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '700' as const },
  labelSmall: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.2 }
} as const;

export type AppColors = { [K in keyof typeof lightColors]: string };

export const useAppTheme = () => {
  const colorScheme = useColorScheme();
  return {
    colors: colorScheme === 'dark' ? darkColors : lightColors,
    dark: colorScheme === 'dark',
    spacing,
    radii,
    typography
  };
};

