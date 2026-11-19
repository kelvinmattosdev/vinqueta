import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/chivo/400.css';
import '@fontsource/chivo/500.css';
import '@fontsource/chivo/600.css';
import '@fontsource/chivo-mono/400.css';
import App from './App';
import { ThemeProvider } from './ThemeProvider';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>);
