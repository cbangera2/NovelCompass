import { useEffect, useState } from 'react';
import { configuredDataMode, DataMode, forcedDataMode, saveDataModePreference } from './data';

export function useDataModePreference() {
  const forcedMode = forcedDataMode();
  const [mode, setMode] = useState<DataMode>(configuredDataMode);
  useEffect(() => {
    const sync = () => setMode(configuredDataMode());
    window.addEventListener('storage', sync);
    window.addEventListener('novel-data-mode', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('novel-data-mode', sync);
    };
  }, []);
  return {
    mode: forcedMode || mode,
    forcedMode,
    setMode: (next: DataMode) => {
      if (forcedMode) return;
      saveDataModePreference(next);
      setMode(next);
    }
  };
}
