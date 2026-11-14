import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/ui/feedback';
import { AppLayout } from './layouts/AppLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { useAuth } from './providers/auth-provider';
import { Login, Register, VerifyEmail, ForgotPassword, ResetPassword } from './pages/auth/AuthPages';
import { About, Blog, BlogPost, Contact, Faq, Features, HowItWorks, Legal, Pricing } from './pages/public/PublicPages';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/app/Dashboard';
import { Devices } from './pages/app/Devices';
import { Energy } from './pages/app/Energy';
import { Billing } from './pages/app/Billing';
import { Wattbot } from './pages/app/Wattbot';
import { Alerts } from './pages/app/Alerts';
import { Settings } from './pages/app/Settings';
import { Admin } from './pages/app/Admin';
import { NotFound } from './pages/NotFound';

function RequireAuth({ children }: { children: React.ReactNode }) {
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

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!['admin', 'super_admin', 'support_agent'].includes(user.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
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

      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="devices" element={<Devices />} />
        <Route path="energy" element={<Energy />} />
        <Route path="billing" element={<Billing />} />
        <Route path="wattbot" element={<Wattbot />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="settings" element={<Settings />} />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
