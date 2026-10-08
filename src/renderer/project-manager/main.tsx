import React from 'react'
import ReactDOM from 'react-dom/client'
import '../shared/i18n'
import '../shared/styles/globals.css'
import { App } from './App'
import { TooltipLayer } from '../shared/components/TooltipLayer'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <TooltipLayer />
  </React.StrictMode>
)
