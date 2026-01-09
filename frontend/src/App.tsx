import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AlertNotification } from './components/AlertNotification';

const MarketList = lazy(() =>
  import('./components/MarketList').then((module) => ({
    default: module.MarketList,
  }))
);

const MarketDetail = lazy(() =>
  import('./components/MarketDetail').then((module) => ({
    default: module.MarketDetail,
  }))
);

function App() {
  // Debug: Log environment variables (remove in production)
  if (import.meta.env.DEV) {
    console.log('API URL:', import.meta.env.VITE_API_URL);
    console.log('WS URL:', import.meta.env.VITE_WS_URL);
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0b0f1a] text-slate-200 antialiased">
        {/* Alert Notifications - Real-time alerts via WebSocket */}
        <AlertNotification position="top-right" maxVisible={5} autoDismiss={10} />
        
        <main>
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-slate-400 font-medium">Syncing with Polymarket CLOB...</p>
                </div>
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<MarketList />} />
              <Route path="/markets/:id" element={<MarketDetail />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;

