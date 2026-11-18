// The verify prompt the user pastes into their agent after an install (#181). Text only: the engine never calls the network
// or `gh issue`; the agent does, and only after a per-issue yes. Strict or offline presets get no filing text at all.
import { feedbackAllowed } from './feedback.mjs';

const REPO = 'estebanmr99/lean-agents';
const DOCTOR = 'npx -y lean-agents@latest --doctor --json';
const DRAFT = 'npx -y lean-agents@latest --feedback-draft --feedback-kind verify --failed-command "<item>"';
const SUMMARY = 'npx -y lean-agents@latest --summary --filed-issue "<item>=<issue url>"';

const TEXT = {
  en: {
    head: 'Verify my lean-agents install. Ask before every change. Never read, print or store my keys or tokens.',
    doctor: `Run \`${DOCTOR}\` and read the rows. Report every row whose status is not \`ok\`.`,
    fix: 'For each problem, propose a fix that stays inside the install plan we agreed on. Ask me before each change. Stop when no fix fits the plan.',
    copy: 'For each problem you could not fix, show me its doctor row (item, status, detail) as text I can copy myself. Do not send it anywhere.',
    draft: `For each problem you could not fix, run \`${DRAFT}\` with the row's \`status: detail\` on stdin. It prints a redacted draft.`,
    dupes: `Search open issues for a duplicate: \`gh issue list --repo ${REPO} --state open --search "<item>"\`. If one matches, show me its link and skip it.`,
    show: 'Show me the full redacted draft.',
    ask: 'Ask me "File this issue? yes/no" for each draft separately. File nothing without my yes. One yes covers one issue only. On no, keep the draft as text I can copy.',
    file: `Only after my yes, run \`gh issue create --repo ${REPO} --title "<title>" --body-file <draft file>\`, then delete the draft file.`,
    link: `Write each issue link back with \`${SUMMARY}\`, then re-run \`npx -y lean-agents@latest --summary\`.`,
    done: 'Finish with one line per problem: fixed, filed (link) or copied.',
  },
  es: {
    head: 'Verifica mi instalación de lean-agents. Pregunta antes de cada cambio. Nunca leas, muestres ni guardes mis claves o tokens.',
    doctor: `Ejecuta \`${DOCTOR}\` y lee las filas. Informa cada fila cuyo estado no sea \`ok\`.`,
    fix: 'Para cada problema, propón una solución que quede dentro del plan de instalación acordado. Pregúntame antes de cada cambio. Detente cuando ninguna solución encaje en el plan.',
    copy: 'Para cada problema que no pudiste resolver, muéstrame su fila de doctor (item, status, detail) como texto que yo mismo pueda copiar. No la envíes a ningún sitio.',
    draft: `Para cada problema que no pudiste resolver, ejecuta \`${DRAFT}\` con el \`status: detail\` de la fila por stdin. Imprime un borrador redactado.`,
    dupes: `Busca un duplicado entre los issues abiertos: \`gh issue list --repo ${REPO} --state open --search "<item>"\`. Si hay uno, muéstrame su enlace y sáltalo.`,
    show: 'Muéstrame el borrador redactado completo.',
    ask: 'Pregúntame "¿Crear este issue? sí/no" por cada borrador, por separado. No crees nada sin mi sí. Un sí cubre un solo issue. Si digo no, deja el borrador como texto que yo pueda copiar.',
    file: `Solo después de mi sí, ejecuta \`gh issue create --repo ${REPO} --title "<título>" --body-file <archivo del borrador>\` y borra el archivo del borrador.`,
    link: `Guarda cada enlace con \`${SUMMARY}\` y vuelve a ejecutar \`npx -y lean-agents@latest --summary\`.`,
    done: 'Termina con una línea por problema: resuelto, creado (enlace) o copiado.',
  },
};

// `network` is the saved or chosen preset; without outbound on, the prompt has no filing steps.
export function verifyPrompt({ lang = 'en', network } = {}) {
  const t = TEXT[lang] ?? TEXT.en;
  const steps = feedbackAllowed(network)
    ? [t.doctor, t.fix, t.draft, t.dupes, t.show, t.ask, t.file, t.link, t.done]
    : [t.doctor, t.fix, t.copy, t.done];
  return [t.head, ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n');
}
