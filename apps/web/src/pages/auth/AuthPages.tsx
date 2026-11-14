import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Zap } from 'lucide-react';
import type * as React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { passwordSchema } from '@wattnexa/shared';
import { Badge } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-surface p-10 lg:flex">
        <div className="absolute inset-0 grid-bg opacity-30" aria-hidden />
        <div className="absolute inset-0 hero-glow" aria-hidden />
        <Link to="/" className="relative flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
            <Zap className="h-4 w-4 text-primary" />
          </span>
          <span className="font-bold">WattNexa</span>
        </Link>
        <div className="relative max-w-sm">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            Know exactly where your electricity bill is going.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Live consumption, tariff-aware estimates and anomalies that actually explain themselves. Simulated
            data is always labelled.
          </p>
        </div>
        <p className="relative text-xs text-muted-foreground">
          Estimates are not official bills. Your provider remains authoritative.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground lg:hidden">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to WattNexa
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-xs text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong. Try again.';

// --- Login -----------------------------------------------------------------

const loginForm = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().default(false),
});

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.input<typeof loginForm>>({
    resolver: zodResolver(loginForm) as never,
    defaultValues: { email: '', password: '', remember: true },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password, Boolean(values.remember));
      toast({ title: 'Signed in', variant: 'success' });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/app', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        navigate(`/verify?email=${encodeURIComponent(values.email)}`);
        return;
      }
      setError(errorMessage(err));
    }
  });

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your household dashboard is waiting."
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" {...form.register('remember')} />
            Remember me for 30 days
          </label>
          <Link to="/forgot-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>

      <Card className="mt-6 border-dashed p-3">
        <p className="text-[11px] font-medium text-muted-foreground">Demo account</p>
        <button
          type="button"
          className="mt-1 text-left text-xs text-foreground hover:text-primary"
          onClick={() => {
            form.setValue('email', 'demo@wattnexa.com');
            form.setValue('password', 'WattNexa@123');
          }}
        >
          demo@wattnexa.com · WattNexa@123 — click to fill
        </button>
      </Card>
    </AuthShell>
  );
}

// --- Register --------------------------------------------------------------

const registerForm = z.object({
  name: z.string().min(2, 'Tell us your name'),
  email: z.string().email('Enter a valid email'),
  password: passwordSchema,
});

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.input<typeof registerForm>>({
    resolver: zodResolver(registerForm) as never,
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await register(values as { name: string; email: string; password: string });
      navigate(
        `/verify?email=${encodeURIComponent(result.email)}${result.devCode ? `&code=${result.devCode}` : ''}`,
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthShell
      title="Create your account"
      subtitle="One household and the live dashboard are free."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <Field label="Name" error={form.formState.errors.name?.message}>
          <Input autoComplete="name" {...form.register('name')} placeholder="Your name" />
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} placeholder="you@example.com" />
        </Field>
        <Field
          label="Password"
          error={form.formState.errors.password?.message}
          hint="At least 8 characters, including a letter and a number."
        >
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

// --- Verify ----------------------------------------------------------------

export function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/verify-email', { email, code });
      toast({ title: 'Email verified', variant: 'success' });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      const result = await api.post<{ devCode?: string }>('/auth/resend-verification', { email });
      if (result.devCode) setCode(result.devCode);
      toast({
        title: 'Code sent',
        description: result.devCode ? 'Development mode: the code below is also valid.' : 'Check your inbox.',
        variant: 'success',
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell title="Verify your email" subtitle="Enter the 6-digit code we sent you.">
      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <Field label="Email">
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Verification code" hint="Development mode shows the code here instead of sending email.">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="000000"
            className="text-center font-mono text-lg tracking-[0.4em]"
            required
          />
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Verify and continue
        </Button>
      </form>
      <div className="mt-4 flex items-center justify-between text-xs">
        <button onClick={resend} disabled={resending} className="text-primary hover:underline disabled:opacity-50">
          {resending ? 'Sending…' : 'Resend code'}
        </button>
        <Link to="/login" className="text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

// --- Forgot / reset --------------------------------------------------------

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ devToken?: string }>('/auth/forgot-password', { email });
      setDevToken(result.devToken ?? null);
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email a link that expires in 30 minutes."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <Badge variant="default">Check your inbox</Badge>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="text-foreground">{email}</span>, a reset link is on its way.
          </p>
          {devToken ? (
            <Card className="border-dashed p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Development mode — no SMTP configured</p>
              <Link
                to={`/reset-password?token=${encodeURIComponent(devToken)}`}
                className="mt-1 block break-all text-xs text-primary hover:underline"
              >
                Open reset link
              </Link>
            </Card>
          ) : null}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

const resetForm = z.object({
  password: passwordSchema,
  confirm: z.string(),
}).refine((values) => values.password === values.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
});

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token') ?? '';

  const form = useForm<z.input<typeof resetForm>>({
    resolver: zodResolver(resetForm) as never,
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password });
      toast({ title: 'Password updated', description: 'Sign in with your new password.', variant: 'success' });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthShell title="Choose a new password" subtitle="All existing sessions will be signed out.">
      {!token ? (
        <p className="text-sm text-destructive">This page needs a valid reset token.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
          <Field label="New password" error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirm password" error={form.formState.errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
