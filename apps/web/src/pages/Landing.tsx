import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Check,
  Cpu,
  Gauge,
  LineChart,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ComparisonBarChart } from '@/components/charts';
import { Badge } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCurrency } from '@wattnexa/shared';

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  currency: string;
  features: string[] | null;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const previewSeries = [
  { label: 'Mon', kwh: 9.4 },
  { label: 'Tue', kwh: 11.2 },
  { label: 'Wed', kwh: 8.1 },
  { label: 'Thu', kwh: 13.6 },
  { label: 'Fri', kwh: 10.4 },
  { label: 'Sat', kwh: 15.2 },
  { label: 'Sun', kwh: 12.8 },
];

const features = [
  {
    icon: Gauge,
    title: 'Live power, honestly measured',
    body: 'Voltage, current, active power and power factor update as readings arrive. Fields the hardware cannot sense are shown as unavailable, never guessed.',
  },
  {
    icon: BarChart3,
    title: 'Tariff-aware bill estimates',
    body: 'Configure your provider, slab rates, fixed charges and taxes. WattNexa tells you which slab you are in and what the next 50 units cost.',
  },
  {
    icon: LineChart,
    title: 'Trends that answer questions',
    body: 'Hourly, daily and monthly views with peak and base-load detection, so you can see what actually moved your consumption.',
  },
  {
    icon: Bell,
    title: 'Alerts worth reading',
    body: 'Thresholds for power, temperature, daily and monthly usage. Suppressed and deduplicated so you are not spammed by a single spike.',
  },
  {
    icon: Bot,
    title: 'WattBot explains the numbers',
    body: 'Ask why your bill moved. WattBot answers from your own authorised readings, with a deterministic fallback when no AI provider is configured.',
  },
  {
    icon: ShieldCheck,
    title: 'Per-device credentials',
    body: 'Every ESP32 gets its own revocable token. No shared secret, no plaintext passwords, no telemetry stream open to the internet.',
  },
];

export function Landing() {
  const plans = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: () => api.get<Plan[]>('/public/plans'),
  });
  const faqs = useQuery({
    queryKey: ['public', 'faqs'],
    queryFn: () => api.get<FaqItem[]>('/public/faqs'),
  });

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 grid-bg opacity-40" aria-hidden />
        <div className="absolute inset-0 hero-glow" aria-hidden />
        <div className="container relative py-20 lg:py-28">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div>
              <Badge variant="outline" className="mb-5 gap-1.5 bg-background/60">
                <Sparkles className="h-3 w-3 text-primary" />
                Energy intelligence for real households
              </Badge>
              <h1 className="text-balance text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                Know exactly where your electricity bill is going.
              </h1>
              <p className="mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground">
                WattNexa connects a non-invasive sensor to your mains, streams real readings to your dashboard,
                and translates them into rupees. No rewiring, no meter replacement, no invented numbers.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to="/register">
                    Start monitoring
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/features">Explore features</Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Demo account available · Simulated data is always labelled
              </p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="relative"
            >
              <Card className="overflow-hidden border-border/80 shadow-lift">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Main Meter · Live
                  </div>
                  <Badge variant="warning">Preview · sample data</Badge>
                </div>
                <div className="grid grid-cols-3 gap-px bg-border">
                  {[
                    { label: 'Now', value: '1.24', unit: 'kW' },
                    { label: 'Today', value: '11.8', unit: 'kWh' },
                    { label: 'Est. bill', value: '₹2,418', unit: '' },
                  ].map((metric) => (
                    <div key={metric.label} className="bg-card p-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                      <p className="mt-1 text-lg font-semibold">
                        {metric.value}
                        <span className="ml-1 text-xs font-medium text-muted-foreground">{metric.unit}</span>
                      </p>
                    </div>
                  ))}
                </div>
                <div className="p-4">
                  <p className="mb-2 text-xs text-muted-foreground">Consumption this week</p>
                  <ComparisonBarChart data={previewSeries} height={190} />
                </div>
                <div className="flex items-center justify-between border-t border-border bg-surface px-5 py-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="h-3 w-3" /> ESP32 · firmware 1.4.2
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Thermometer className="h-3 w-3" /> 32.4 °C
                  </span>
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Device */}
      <section className="border-b border-border bg-surface">
        <div className="container grid items-center gap-12 py-16 lg:grid-cols-2">
          <div>
            <Badge variant="outline" className="mb-4">Hardware</Badge>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">A small device on your mains cable</h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
              A clamp-on CT sensor wraps around the incoming live wire. The ESP32 samples it, buffers readings
              through connectivity gaps, and uploads over Wi-Fi. Nothing is cut, spliced or rewired.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                'Non-invasive current sensing — no electrician required',
                'Temperature sensing and LED status ring on the device',
                'Local memory buffers readings while offline',
                'Per-device revocable credentials, never a shared secret',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <Card className="relative overflow-hidden p-8">
            <div className="absolute inset-0 grid-bg opacity-30" aria-hidden />
            <div className="relative mx-auto flex h-52 w-52 items-center justify-center rounded-full border border-primary/25 bg-background/60 shadow-lift">
              <div className="absolute inset-3 rounded-full border border-dashed border-border" />
              <div className="text-center">
                <Zap className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-2 text-xs font-semibold">WattNexa CT-1</p>
                <p className="text-[11px] text-muted-foreground">ESP32 · Wi-Fi · MQTT</p>
              </div>
            </div>
            <div className="relative mt-8 grid grid-cols-3 gap-2 text-center text-[11px]">
              {['CT sensor', 'Temperature', 'LED ring'].map((item) => (
                <div key={item} className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground">
                  {item}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="container border-b border-border py-16">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">How it works</Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Three steps from cable to clarity</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Pairing takes a few minutes. The interesting part is what happens afterwards.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Clamp and pair',
              body: 'Clip the sensor around your mains live wire, power the device, and enter the pairing code shown in WattNexa.',
              icon: PlugZap,
            },
            {
              step: '02',
              title: 'Configure your tariff',
              body: 'Add your provider and slab rates once. WattNexa converts every kWh into the amount you actually pay.',
              icon: BarChart3,
            },
            {
              step: '03',
              title: 'Act on what you see',
              body: 'Watch live draw, catch abnormal peaks, and get a monthly picture you can compare against the real bill.',
              icon: Gauge,
            },
          ].map((item) => (
            <Card key={item.step} className="p-6">
              <div className="flex items-center justify-between">
                <item.icon className="h-5 w-5 text-primary" />
                <span className="font-mono text-xs text-muted-foreground">{item.step}</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="container py-16">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">Features</Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for people who read the bill</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="p-6 transition-colors hover:border-primary/30">
              <feature.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 text-sm font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* WattBot */}
      <section className="border-y border-border bg-surface">
        <div className="container grid items-center gap-10 py-16 lg:grid-cols-2">
          <div>
            <Badge variant="outline" className="mb-4">WattBot</Badge>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              An assistant that has actually read your meter
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
              WattBot answers from your readings, tariff and device state. If no AI provider is configured it
              falls back to a deterministic engine that still cites only your real figures.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/register">Try WattBot</Link>
            </Button>
          </div>
          <Card className="p-5">
            <div className="space-y-3">
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                Why is my bill higher this month?
              </div>
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-background px-4 py-3 text-sm">
                <p className="leading-relaxed text-muted-foreground">
                  This month you have used <strong className="text-foreground">284.6 kWh</strong>, about{' '}
                  <strong className="text-foreground">18% more</strong> than the same point last month. Most of
                  the increase came from evening peaks between 18:00 and 21:00.
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Estimates from your configured tariff — not your provider&apos;s bill.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Pricing */}
      <section className="container py-16">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">Pricing</Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Start free, upgrade when you need history</h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {(plans.data ?? []).map((plan) => (
            <Card
              key={plan.id}
              className={plan.slug === 'plus' ? 'relative border-primary/40 p-6 shadow-lift' : 'p-6'}
            >
              {plan.slug === 'plus' ? (
                <Badge className="absolute right-4 top-4">Most popular</Badge>
              ) : null}
              <p className="text-sm font-semibold">{plan.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>
              <p className="mt-4 text-3xl font-bold tracking-tight">
                {plan.priceMonthly === 0 ? 'Free' : formatCurrency(plan.priceMonthly, plan.currency)}
                {plan.priceMonthly > 0 ? (
                  <span className="text-sm font-medium text-muted-foreground">/month</span>
                ) : null}
              </p>
              <ul className="mt-5 space-y-2 text-xs">
                {(plan.features ?? []).map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full" variant={plan.slug === 'plus' ? 'default' : 'outline'}>
                <Link to="/register">Get started</Link>
              </Button>
            </Card>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="container border-t border-border py-16">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">Early access feedback</Badge>
          <h2 className="text-2xl font-bold tracking-tight">What early households are saying</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Sample content from the early-access programme. Names are withheld until participants approve publication.
          </p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              quote:
                'The slab breakdown was the first time I understood why my last 60 units cost twice as much as my first 60.',
              role: 'Apartment owner, Bengaluru',
            },
            {
              quote:
                'It caught a water heater left on overnight. That single alert paid for a year of monitoring.',
              role: 'Homeowner, Pune',
            },
            {
              quote:
                'I like that it refuses to show voltage when the sensor cannot measure it instead of making a number up.',
              role: 'Electronics engineer, Hyderabad',
            },
          ].map((item) => (
            <Card key={item.role} className="p-6">
              <p className="text-sm leading-relaxed text-muted-foreground">&ldquo;{item.quote}&rdquo;</p>
              <p className="mt-4 text-[11px] font-medium">{item.role}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="container border-t border-border py-16">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <Badge variant="outline" className="mb-4">FAQ</Badge>
            <h2 className="text-2xl font-bold tracking-tight">Questions worth asking</h2>
          </div>
          <div className="mt-8 space-y-3">
            {(faqs.data ?? []).slice(0, 4).map((faq) => (
              <details key={faq.id} className="group rounded-xl border border-border bg-card p-5">
                <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {faq.question}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
          <div className="mt-6 text-center">
            <Button asChild variant="link">
              <Link to="/faq">Read all questions</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container pb-20">
        <Card className="relative overflow-hidden border-primary/25 p-10 text-center">
          <div className="absolute inset-0 hero-glow" aria-hidden />
          <div className="relative">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Your bill already tells you the total. WattNexa tells you the rest.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              Create an account, explore the demo household, and connect a device when you are ready.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/register">
                  Create free account
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">Use the demo account</Link>
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
