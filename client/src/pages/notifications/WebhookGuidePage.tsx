import type { CSSProperties, ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';

const steps = ['receiver', 'add', 'secret', 'verify', 'respond', 'test'] as const;

const nodeSample = `import crypto from 'node:crypto';
import express from 'express';

const secret = process.env.ELEC_WEBHOOK_SECRET;
const app = express();

app.post('/elec-hook', express.raw({ type: 'application/json' }), (req, res) => {
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  const received = req.get('X-Elec-Signature') ?? '';
  const valid =
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  console.log(req.get('X-Elec-Delivery'), event.event, event.device?.name);
  res.sendStatus(204);
});

app.listen(3000);`;

const pythonSample = `import hashlib, hmac, os
from flask import Flask, abort, request

secret = os.environ["ELEC_WEBHOOK_SECRET"].encode()
app = Flask(__name__)

@app.post("/elec-hook")
def elec_hook():
    body = request.get_data()
    expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("X-Elec-Signature", "")):
        abort(401)

    event = request.get_json()
    print(request.headers["X-Elec-Delivery"], event["event"], event.get("device"))
    return "", 204`;

const payloadSample = `{
  "event": "device.offline",
  "device": { "id": "0193f1c2-…", "name": "Home" },
  "outage": {
    "id": "0193f1c9-…",
    "type": "OUTAGE",
    "started_at": "2026-11-21T16:42:00.000Z",
    "ended_at": null,
    "duration_s": null,
    "cause": null,
    "kind": null,
    "ota_attempt_id": null
  },
  "sent_at": "2026-11-21T16:44:00.000Z"
}`;

const headers = [
  { name: 'X-Elec-Event', key: 'event' },
  { name: 'X-Elec-Delivery', key: 'delivery' },
  { name: 'X-Elec-Signature', key: 'signature' },
  { name: 'User-Agent', key: 'userAgent' },
] as const;

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-xs leading-relaxed text-secondary-foreground">
      <code>{children}</code>
    </pre>
  );
}

const inlineCode = <code className="rounded bg-secondary px-1 font-mono text-[0.9em] break-all" />;

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <li
      data-motion="enter"
      style={{ '--i': index } as CSSProperties}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2"
    >
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-full bg-primary font-heading text-sm font-semibold text-primary-foreground tabular-nums"
      >
        {index + 1}
      </span>
      <h2 className="self-center font-heading text-lg font-medium">{title}</h2>
      <div className="col-start-2 flex min-w-0 flex-col gap-3 text-muted-foreground">
        {children}
      </div>
    </li>
  );
}

function StepBody({ step }: { step: (typeof steps)[number] }) {
  const { t } = useTranslation();
  const body = (
    <p>
      <Trans i18nKey={`app.webhookGuide.steps.${step}.body`} components={{ code: inlineCode }} />
    </p>
  );
  if (step === 'verify') {
    return (
      <>
        {body}
        <Tabs defaultValue="node" className="gap-2">
          <TabsList variant="pill" aria-label={t('app.webhookGuide.language')}>
            <TabsTab value="node">Node.js</TabsTab>
            <TabsTab value="python">Python</TabsTab>
          </TabsList>
          <TabsPanel value="node">
            <Code>{nodeSample}</Code>
          </TabsPanel>
          <TabsPanel value="python">
            <Code>{pythonSample}</Code>
          </TabsPanel>
        </Tabs>
      </>
    );
  }
  if (step === 'respond') {
    return (
      <>
        {body}
        <ul className="flex list-disc flex-col gap-1 ps-5">
          {(['dedupe', 'retries', 'shutoff'] as const).map((point) => (
            <li key={point}>
              <Trans
                i18nKey={`app.webhookGuide.steps.respond.${point}`}
                components={{ code: inlineCode }}
              />
            </li>
          ))}
        </ul>
      </>
    );
  }
  return body;
}

export function WebhookGuidePage() {
  const { t } = useTranslation();
  return (
    <article className="flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <BackLink to="/notifications" label={t('app.webhookGuide.back')} preferHistory />
        <h1 className="font-heading text-2xl font-semibold text-balance">
          {t('app.webhookGuide.title')}
        </h1>
        <p className="text-muted-foreground">{t('app.webhookGuide.intro')}</p>
      </header>
      <ol aria-label={t('app.webhookGuide.stepsLabel')} className="flex flex-col gap-8">
        {steps.map((step, index) => (
          <Step key={step} index={index} title={t(`app.webhookGuide.steps.${step}.title`)}>
            <StepBody step={step} />
          </Step>
        ))}
      </ol>
      <section
        aria-labelledby="webhook-reference"
        className="flex flex-col gap-4 border-t border-border pt-6"
      >
        <h2 id="webhook-reference" className="font-heading text-lg font-medium">
          {t('app.webhookGuide.reference.title')}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
          {headers.map((header) => (
            <div key={header.name} className="contents">
              <dt className="font-mono text-sm font-medium">{header.name}</dt>
              <dd className="text-sm text-muted-foreground max-sm:-mt-2">
                {t(`app.webhookGuide.reference.headers.${header.key}`)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">{t('app.webhookGuide.reference.payload')}</p>
        <Code>{payloadSample}</Code>
      </section>
    </article>
  );
}
