/** Build-time access to the DataWeave practice exercises (synced to .notes/practice/dataweave.json). */
import fs from "node:fs";
import path from "node:path";

export interface DwExercise {
  /** stable id from the title, used for progress and links (#<id>) */
  id: string;
  title: string;
  level: "easy" | "medium" | "hard";
  /** lesson that teaches it */
  sid: string;
  task: string;
  inputType: string;
  input: string;
  /** the model script */
  answer: string;
  output: string;
  explain: string;
}

const FILE = path.join(process.cwd(), ".notes", "practice", "dataweave.json");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let cache: DwExercise[] | null = null;
export function dwExercises(): DwExercise[] {
  if (cache) return cache;
  if (!fs.existsSync(FILE)) return (cache = []);
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Omit<DwExercise, "id">[];
  const used = new Set<string>();
  cache = raw.map((e) => {
    let id = slug(e.title) || "exercise";
    for (let n = 2; used.has(id); n++) id = `${slug(e.title)}-${n}`;
    used.add(id);
    return { ...e, id };
  });
  return cache;
}

/** the code-fence language for a MIME type */
export const fenceLang = (mime: string) => (/json/.test(mime) ? "json" : /xml/.test(mime) ? "xml" : /csv/.test(mime) ? "csv" : "text");
