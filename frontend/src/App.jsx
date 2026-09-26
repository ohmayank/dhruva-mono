import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import Dashboard from './dashboard/dashboard';
import Landing from './landing/Landing';
import Welcome from './components/welcome/Welcome';
import AllObservations from './components/observations/AllObservations';
import ObservationLogs from './components/logs/ObservationLogs';

const MaitriWeather = lazy(() => import('./pages/maitri/weather/Weather'));
const BhartiWeather = lazy(() => import('./pages/bharti/weather/Weather'));

const router = createBrowserRouter([
  { path: '/', Component: Landing },
  {
  path: '/app',
  Component: Dashboard,
  children: [
    { index: true, Component: Welcome },
    { path: 'observations', Component: AllObservations },
    { path: 'logs', Component: ObservationLogs },
    { path: 'maitri/weather', element: <Suspense fallback={<p>Loading Maitri observations…</p>}><MaitriWeather /></Suspense> },
    { path: 'bharti/weather', element: <Suspense fallback={<p>Loading Bharati observations…</p>}><BhartiWeather /></Suspense> },
  ],
},
  { path: '/observations', element: <Navigate to="/app/observations" replace /> },
  { path: '/maitri/weather', element: <Navigate to="/app/maitri/weather" replace /> },
  { path: '/bharti/weather', element: <Navigate to="/app/bharti/weather" replace /> },
]);

export default function App() { return <RouterProvider router={router} />; }
