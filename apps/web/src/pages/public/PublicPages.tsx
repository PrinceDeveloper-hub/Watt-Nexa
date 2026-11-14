import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Check } from 'lucide-react';
import type * as React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatCurrency } from '@wattnexa/shared';
import { formatDate } from '@/lib/utils';

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  currency: string;
  features: string[] | null;
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="container max-w-5xl py-16">{children}</div>
);

const intro = (eyebrow: string, title: string, body: string) => (
  <div className="mx-auto max-w-2xl text-center">
    <Badge variant="outline" className="mb-4">{eyebrow}</Badge>
    <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
  </div>
);

export function Features() {
  const groups = [
    {
      title: 'Monitoring',
      items: [
        ['Live metrics', 'Voltage, current, active power, power factor and energy, refreshed as readings arrive.'],
        ['Device health', 'Last seen, signal strength, firmware and offline detection with automatic alerts.'],
        ['Multi-home', 'Separate households for home, office or shop, each with its own devices and tariff.'],
      ],
    },
    {
      title: 'Understanding',
      items: [
        ['Bill estimation', 'Progressive slab tariffs, fixed charges and tax modelled exactly as providers bill them.'],
        ['Peak & base load', 'See the highest draw and the standby floor you pay for continuously.'],
        ['Comparisons', 'Month over month, with a clear percentage change and no implied savings guarantees.'],
      ],
    },
    {
      title: 'Acting',
      items: [
        ['Threshold alerts', 'Your own limits for power, temperature, daily and monthly consumption.'],
        ['WattBot', 'Context-aware answers from your data, with a rule-based fallback and no fabrication.'],
        ['Exports', 'Daily consumption as CSV or a branded PDF report you can keep.'],
      ],
    },
    {
      title: 'Safety',
      items: [
        ['Per-device tokens', 'Each ESP32 authenticates separately and can be revoked independently.'],
        ['Data isolation', 'Every query is scoped to households you own or are a member of.'],
        ['Audit trail', 'Administrative actions are recorded with actor, action and affected resource.'],
      ],
    },
  ];

  return (
    <Shell>
      {intro(
        'Features',
        'Everything needed to explain a bill',
        'WattNexa is deliberately narrow: measure honestly, translate to money, and point at what changed.',
      )}
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.title} className="p-6">
            <h2 className="text-sm font-semibold">{group.title}</h2>
            <ul className="mt-4 space-y-4">
              {group.items.map(([title, body]) => (
                <li key={title}>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {title}
                  </p>
                  <p className="mt-1 pl-5.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

export function HowItWorks() {
  const steps = [
    ['Install the sensor', 'Clamp the CT sensor around the live conductor entering your distribution board. The device is powered over USB.'],
    ['Pair it to your account', 'Generate a pairing code in the app and enter it during device setup, or scan the QR label.'],
    ['Readings arrive', 'The device publishes to MQTT or posts to the HTTP telemetry endpoint using its own bearer token.'],
    ['Tariff in, rupees out', 'Add your provider and slab rates. Every chart and estimate now speaks in currency.'],
    ['Compare with the real bill', 'Record the actual amount when the provider bill arrives and see how close the estimate was.'],
  ];

  return (
    <Shell>
      {intro('How it works', 'From clamp to clarity', 'Five steps, and only the first one involves a screwdriver-free trip to your distribution board.')}
      <ol className="mx-auto mt-12 max-w-2xl space-y-3">
        {steps.map(([title, body], index) => (
          <li key={title} className="flex gap-4 rounded-xl border border-border bg-card p-5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Safety note:</strong> WattNexa never switches mains power. It does not
        implement remote appliance control, because that requires certified switching hardware and an electrician.
      </div>
    </Shell>
  );
}

export function Pricing() {
  const plans = useQuery({ queryKey: ['public', 'plans'], queryFn: () => api.get<Plan[]>('/public/plans') });

  return (
    <Shell>
      {intro('Pricing', 'Plans that scale with history, not hype', 'Every plan measures the same things. Paid plans keep more history and unlock WattBot and exports.')}
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {plans.isLoading
          ? [0, 1, 2].map((key) => <Skeleton key={key} className="h-72" />)
          : (plans.data ?? []).map((plan) => (
              <Card key={plan.id} className={plan.slug === 'plus' ? 'border-primary/40 p-6 shadow-lift' : 'p-6'}>
                <p className="text-sm font-semibold">{plan.name}</p>
                <p className="mt-1 min-h-[32px] text-xs text-muted-foreground">{plan.description}</p>
                <p className="mt-4 text-3xl font-bold">
                  {plan.priceMonthly === 0 ? 'Free' : formatCurrency(plan.priceMonthly, plan.currency)}
                  {plan.priceMonthly > 0 ? <span className="text-sm font-medium text-muted-foreground">/mo</span> : null}
                </p>
                <ul className="mt-5 space-y-2 text-xs">
                  {(plan.features ?? []).map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-6 w-full" variant={plan.slug === 'plus' ? 'default' : 'outline'}>
                  <Link to="/register">Choose {plan.name}</Link>
                </Button>
              </Card>
            ))}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Payments run in sandbox mode until a payment provider is configured. Sandbox invoices are never marked paid
        without a real capture.
      </p>
    </Shell>
  );
}

export function Faq() {
  const faqs = useQuery({
    queryKey: ['public', 'faqs'],
    queryFn: () => api.get<Array<{ id: string; question: string; answer: string; category: string }>>('/public/faqs'),
  });

  return (
    <Shell>
      {intro('FAQ', 'Answers before you sign up', 'If something is missing, the contact page reaches a human.')}
      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        {faqs.isLoading ? <Skeleton className="h-40" /> : null}
        {(faqs.data ?? []).map((faq) => (
          <details key={faq.id} className="group rounded-xl border border-border bg-card p-5">
            <summary className="cursor-pointer list-none text-sm font-medium">
              <span className="flex items-center justify-between gap-4">
                {faq.question}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{faq.answer}</p>
          </details>
        ))}
      </div>
    </Shell>
  );
}

export function About() {
  return (
    <Shell>
      {intro('About', 'Built around one honest question', 'Where is the money going? Most energy apps answer with graphics. We answer with arithmetic.')}
      <div className="mx-auto mt-10 max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          WattNexa started as a hardware experiment: a clamp sensor, an ESP32, and a spreadsheet full of numbers that
          did not match the electricity bill. The gap between energy consumed and money charged turned out to be the
          most useful thing to visualise.
        </p>
        <p>
          So the product is built around three commitments. Measure only what the hardware can actually sense. Label
          every simulated figure. And never present an estimate as an official amount.
        </p>
        <p>
          That is why unavailable fields stay empty instead of showing zero, why the demo household is marked as
          simulated, and why every cost view carries a disclaimer.
        </p>
        <p className="text-foreground">
          WattNexa — know exactly where your electricity bill is going.
        </p>
      </div>
    </Shell>
  );
}

const contactSchema = z.object({
  name: z.string().min(2, 'Tell us your name'),
  email: z.string().email('Enter a valid email'),
  topic: z.enum(['sales', 'support', 'partnership', 'other']),
  message: z.string().min(10, 'A little more detail helps'),
});

export function Contact() {
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: '', email: '', topic: 'support', message: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/public/contact', values);
      setSent(true);
      toast({ title: 'Message received', description: 'We reply within one business day.', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not send message',
        description: error instanceof Error ? error.message : 'Try again shortly.',
        variant: 'error',
      });
    }
  });

  return (
    <Shell>
      {intro('Contact', 'Talk to the team', 'Sales, support, or a hardware question — this reaches a person.')}
      <div className="mx-auto mt-10 grid max-w-3xl gap-4 md:grid-cols-5">
        <Card className="p-6 md:col-span-3">
          {sent ? (
            <EmptyState
              icon={Check}
              title="Message received"
              description="We have it. Expect a reply at the address you provided within one business day."
              action={
                <Button variant="outline" onClick={() => setSent(false)}>
                  Send another
                </Button>
              }
            />
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" error={form.formState.errors.name?.message}>
                  <Input {...form.register('name')} placeholder="Your name" />
                </Field>
                <Field label="Email" error={form.formState.errors.email?.message}>
                  <Input type="email" {...form.register('email')} placeholder="you@example.com" />
                </Field>
              </div>
              <Field label="Topic">
                <Select {...form.register('topic')}>
                  <option value="sales">Sales &amp; plans</option>
                  <option value="support">Support</option>
                  <option value="partnership">Partnership</option>
                  <option value="other">Something else</option>
                </Select>
              </Field>
              <Field label="Message" error={form.formState.errors.message?.message}>
                <Textarea {...form.register('message')} placeholder="What can we help with?" />
              </Field>
              <Button type="submit" loading={form.formState.isSubmitting}>
                Send message
              </Button>
            </form>
          )}
        </Card>
        <Card className="space-y-4 p-6 md:col-span-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Support</p>
            <p className="mt-1 text-sm">support@wattnexa.com</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales</p>
            <p className="mt-1 text-sm">sales@wattnexa.com</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hours</p>
            <p className="mt-1 text-xs text-muted-foreground">Mon–Sat, 10:00–19:00 IST</p>
          </div>
        </Card>
      </div>
    </Shell>
  );
}

export function Blog() {
  const posts = useQuery({
    queryKey: ['public', 'blog'],
    queryFn: () => api.get<Array<{ id: string; slug: string; title: string; excerpt: string; publishedAt: string | null }>>('/public/blog'),
  });

  return (
    <Shell>
      {intro('Resources', 'Notes on measuring energy honestly', 'Short reads on tariffs, sensors and the gap between kWh and rupees.')}
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {posts.isLoading ? <Skeleton className="h-40 md:col-span-2" /> : null}
        {(posts.data ?? []).map((post) => (
          <Link key={post.id} to={`/blog/${post.slug}`}>
            <Card className="h-full p-6 transition-colors hover:border-primary/40">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {post.publishedAt ? formatDate(post.publishedAt) : 'Draft'}
              </p>
              <h2 className="mt-2 text-sm font-semibold">{post.title}</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{post.excerpt}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                Read <ArrowRight className="h-3 w-3" />
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </Shell>
  );
}

export function BlogPost() {
  const { slug } = useParams();
  const post = useQuery({
    queryKey: ['public', 'blog', slug],
    queryFn: () => api.get<{ title: string; content: string; publishedAt: string | null }>(`/public/blog/${slug}`),
    enabled: Boolean(slug),
  });

  return (
    <Shell>
      {post.isLoading ? <Skeleton className="h-64" /> : null}
      {post.data ? (
        <article className="mx-auto max-w-2xl">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {post.data.publishedAt ? formatDate(post.data.publishedAt) : ''}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{post.data.title}</h1>
          <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
            {post.data.content.split('\n\n').map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </div>
          <Button asChild variant="outline" className="mt-8">
            <Link to="/blog">All resources</Link>
          </Button>
        </article>
      ) : null}
      {post.isError ? (
        <EmptyState title="Article not found" description="It may have been unpublished." />
      ) : null}
    </Shell>
  );
}

export function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy';
  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <Badge variant="outline" className="mb-4">Legal</Badge>
        <h1 className="text-3xl font-bold tracking-tight">
          {isPrivacy ? 'Privacy policy' : 'Terms & conditions'}
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">Last updated {formatDate(new Date())}</p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted-foreground">
          {(isPrivacy
            ? [
                ['What we collect', 'Account details (name, email), household configuration, device metadata and the telemetry your devices send.'],
                ['Why', 'To display your consumption, estimate costs, and alert you about thresholds you configure.'],
                ['Retention', 'Telemetry is retained according to your plan. Aggregated daily figures are retained longer than raw samples.'],
                ['Sharing', 'We do not sell personal data. Email delivery and payment processing use configured providers.'],
                ['Your controls', 'You can export consumption data, revoke device credentials, end sessions and delete your account from settings.'],
                ['Contact', 'privacy@wattnexa.com for any data request.'],
              ]
            : [
                ['Estimates, not bills', 'Cost figures in WattNexa are estimates derived from your tariff configuration and readings. Your electricity provider\u2019s bill is authoritative.'],
                ['Simulated data', 'Demo and simulated readings are labelled as such. They must not be used for billing disputes.'],
                ['Device safety', 'WattNexa does not switch mains power. Installation of sensing hardware must be safe and compliant with local regulations.'],
                ['Acceptable use', 'Do not attempt to access another household\u2019s data or to submit falsified telemetry.'],
                ['Availability', 'Early-access service is provided as-is, without uptime guarantees.'],
                ['Contact', 'legal@wattnexa.com'],
              ]
          ).map(([title, body]) => (
            <section key={title}>
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              <p className="mt-1">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </Shell>
  );
}
