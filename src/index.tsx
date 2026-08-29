import 'core-js/features/object/assign'
import 'core-js/features/object/values'
import React from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { HelmetProvider } from 'react-helmet-async'
import store from './state'
import App from './App'
import { LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment'

import * as serviceWorker from './serviceWorker'

// Адрес проекта мониторинга. Переменная перекрывает зашитое значение —
// так стенд шлёт события в свой проект, а не в чужой боевой. Без
// переменной боевая сборка ведёт себя как прежде
const SENTRY_DSN = process.env.REACT_APP_SENTRY_DSN ||
  (process.env.NODE_ENV === 'production' ?
    'https://8181d1719b4f41e0b4f6c2c8c449e0f7@o1155911.ingest.sentry.io/6236737' :
    '')

if(SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.REACT_APP_SENTRY_ENV || process.env.NODE_ENV,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.captureConsoleIntegration({
        levels: ['error'],
      }),
    ],
    tracesSampleRate: 1.0,
  })
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider store={store}>
        <LocalizationProvider dateAdapter={AdapterMoment}>
          <HelmetProvider>
            <Sentry.ErrorBoundary>
              <App/>
            </Sentry.ErrorBoundary>
          </HelmetProvider>
        </LocalizationProvider>
      </Provider>
    </BrowserRouter>
  </React.StrictMode>,
)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.register()
