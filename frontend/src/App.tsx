import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

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
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="container mx-auto px-4 py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Polymarket Dashboard
            </h1>
          </div>
        </header>
        <main>
          <Suspense
            fallback={
              <div className="container mx-auto px-4 py-8">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  <p className="mt-4 text-gray-600">Loading...</p>
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

