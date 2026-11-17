import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPanel } from '../src/SettingsPanel';
import { ExportPanel } from '../src/ExportPanel';
import { DEFAULT_SETTINGS } from '../src/intro/settings';
import '../src/index.css';

function Harness() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  return <><SettingsPanel settings={settings} onChange={setSettings} /><ExportPanel settings={settings} onStart={() => {}} /></>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
