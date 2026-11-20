import type {
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

const esc = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

/**
 * Envia o resultado de cada jornada para o Prometheus Pushgateway.
 * Métricas (labels job/journey vêm do grouping key da URL):
 *   synthetic_check_success                    1 = passou, 0 = falhou
 *   synthetic_check_duration_seconds           duração total da jornada
 *   synthetic_check_retries                    tentativas extras usadas
 *   synthetic_check_last_run_timestamp_seconds para detectar jornada parada
 *   synthetic_step_success{step}               por passo (test.step)
 *   synthetic_step_duration_seconds{step}
 */
class PushgatewayReporter implements Reporter {
  private results = new Map<string, { test: TestCase; result: TestResult }>();

  onTestEnd(test: TestCase, result: TestResult) {
    // Com retries, a última tentativa sobrescreve as anteriores.
    this.results.set(test.id, { test, result });
  }

  async onEnd() {
    const base = process.env.PUSHGATEWAY_URL;
    if (!base) {
      console.warn('PUSHGATEWAY_URL não definido; métricas não enviadas.');
      return;
    }

    const now = Date.now() / 1000;

    for (const { test, result } of this.results.values()) {
      const ok = result.status === 'passed';
      const steps = result.steps.filter((s) => s.category === 'test.step');

      const lines = [
        '# TYPE synthetic_check_success gauge',
        `synthetic_check_success ${ok ? 1 : 0}`,
        '# TYPE synthetic_check_duration_seconds gauge',
        `synthetic_check_duration_seconds ${result.duration / 1000}`,
        '# TYPE synthetic_check_retries gauge',
        `synthetic_check_retries ${result.retry}`,
        '# TYPE synthetic_check_last_run_timestamp_seconds gauge',
        `synthetic_check_last_run_timestamp_seconds ${now}`,
        '# TYPE synthetic_step_success gauge',
        ...steps.map(
          (s) => `synthetic_step_success{step="${esc(s.title)}"} ${s.error ? 0 : 1}`,
        ),
        '# TYPE synthetic_step_duration_seconds gauge',
        ...steps.map(
          (s) => `synthetic_step_duration_seconds{step="${esc(s.title)}"} ${s.duration / 1000}`,
        ),
      ];

      const url = `${base.replace(/\/$/, '')}/metrics/job/synthetics/journey/${encodeURIComponent(test.title)}`;

      try {
        // PUT substitui todo o grupo: passos que não rodaram não ficam "presos".
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain; version=0.0.4' },
          body: lines.join('\n') + '\n',
        });
        if (!res.ok) {
          console.error(`Pushgateway respondeu ${res.status}: ${await res.text()}`);
        }
      } catch (err) {
        console.error('Falha ao enviar métricas ao Pushgateway:', err);
      }
    }
  }
}

export default PushgatewayReporter;
