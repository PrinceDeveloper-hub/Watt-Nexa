import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/ui/feedback';
import { PageLoading } from './components/skeletons';
import { AppLayout } from './layouts/AppLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { useAuth } from './providers/auth-provider';
import { Forbidden, NotFound } from './pages/error-pages';

const Landing = lazy(() => import('./pages/Landing').then((module) => ({ default: module.Landing })));
const Features = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.Features })));
const HowItWorks = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.HowItWorks })));
const Pricing = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.Pricing })));
const Faq = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.Faq })));
const About = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.About })));
const Contact = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.Contact })));
const Blog = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.Blog })));
const BlogPost = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.BlogPost })));
const Legal = lazy(() => import('./pages/public/PublicPages').then((module) => ({ default: module.Legal })));

const Login = lazy(() => import('./pages/auth/AuthPages').then((module) => ({ default: module.Login })));
const Register = lazy(() => import('./pages/auth/AuthPages').then((module) => ({ default: module.Register })));
const VerifyEmail = lazy(() => import('./pages/auth/AuthPages').then((module) => ({ default: module.VerifyEmail })));
const ForgotPassword = lazy(() =>
  import('./pages/auth/AuthPages').then((module) => ({ default: module.ForgotPassword })),
);
const ResetPassword = lazy(() =>
  import('./pages/auth/AuthPages').then((module) => ({ default: module.ResetPassword })),
);

const Dashboard = lazy(() => import('./pages/app/Dashboard').then((module) => ({ default: module.Dashboard })));
const Devices = lazy(() => import('./pages/app/Devices').then((module) => ({ default: module.Devices })));
const Energy = lazy(() => import('./pages/app/Energy').then((module) => ({ default: module.Energy })));
const Billing = lazy(() => import('./pages/app/Billing').then((module) => ({ default: module.Billing })));
const Alerts = lazy(() => import('./pages/app/Alerts').then((module) => ({ default: module.Alerts })));
const Settings = lazy(() => import('./pages/app/Settings').then((module) => ({ default: module.Settings })));
const Admin = lazy(() => import('./pages/app/Admin').then((module) => ({ default: module.Admin })));
const Wattbot = lazy(() => import('./pages/app/Wattbot').then((module) => ({ default: module.Wattbot })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!['admin', 'super_admin', 'support_agent'].includes(user.role)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}

const LEGACY_APP_ROUTES: Record<string, string> = {
  '': '/dashboard',
  devices: '/devices',
  energy: '/energy-analytics',
  billing: '/billing',
  wattbot: '/wattbot',
  alerts: '/alerts',
  settings: '/settings',
  admin: '/admin',
};

/** Permanent redirects from the old `/app/*` structure. */
function LegacyAppRedirect() {
  const { pathname, search } = useLocation();
  const suffix = pathname.replace(/^\/app\/?/, '').replace(/\/+$/, '');
  const target = LEGACY_APP_ROUTES[suffix] ?? '/dashboard';
  return <Navigate to={`${target}${search}`} replace />;
}

function authPage(node: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10">
          <PageLoading label="Loading sign-in" />
        </div>
      }
    >
      {node}
    </Suspense>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Landing />} />
        <Route path="/features" element={<Features />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
      </Route>

      <Route path="/login" element={authPage(<Login />)} />
      <Route path="/register" element={authPage(<Register />)} />
      <Route path="/verify" element={authPage(<VerifyEmail />)} />
      <Route path="/forgot-password" element={authPage(<ForgotPassword />)} />
      <Route path="/reset-password" element={authPage(<ResetPassword />)} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/energy-analytics" element={<Energy />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/wattbot" element={<Wattbot />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/403" element={<Forbidden />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="/app" element={<LegacyAppRedirect />} />
      <Route path="/app/*" element={<LegacyAppRedirect />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
