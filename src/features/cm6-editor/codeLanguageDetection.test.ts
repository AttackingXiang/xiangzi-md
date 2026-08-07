import { describe, expect, it } from 'vitest'
import { detectCodeLanguage } from './codeLanguageDetection'

/**
 * Snippets in the shape people actually paste: a few lines lifted out of a file, not
 * a complete program. `expected` is the fence value, or '' where abstaining is the
 * right answer. Anything here that regresses is a real regression — resist the urge
 * to relax an expectation to '' without checking why the evidence disappeared.
 */
const corpus: readonly (readonly [name: string, expected: string, snippet: string])[] = [
  // — JavaScript / TypeScript ————————————————————————————
  ['js function', 'javascript', 'function add(a, b) {\n  return a + b\n}'],
  ['js await', 'javascript', 'const res = await fetch(url)\nconst data = await res.json()'],
  ['js commonjs', 'javascript', "const fs = require('fs')\nmodule.exports = { fs }"],
  [
    'js array chain',
    'javascript',
    'const names = users.map((user) => user.name).filter((name) => name !== null)',
  ],
  ['ts generic', 'typescript', 'export function pick<T, K extends keyof T>(o: T, k: K) {\n  return o[k]\n}'], // prettier-ignore
  ['ts interface', 'typescript', 'interface User {\n  id: number\n  name: string\n}'],
  ['ts union type', 'typescript', 'type Result = { ok: true } | { ok: false; error: string }'],
  ['ts annotated props', 'typescript', 'const App = ({ title }: Props) => {\n  return <div>{title}</div>\n}'], // prettier-ignore
  ['ts class member', 'typescript', 'export class Store {\n  private items: string[] = []\n\n  add(item: string): void {\n    this.items.push(item)\n  }\n}'], // prettier-ignore

  // — Python ————————————————————————————————————————————
  ['python loop', 'python', 'for i in range(10):\n    print(i * 2)'],
  ['python imports', 'python', 'import numpy as np\n\narr = np.zeros((3, 3))\nprint(arr.shape)'],
  ['python class', 'python', 'class Dog(Animal):\n    def bark(self):\n        return None'],
  ['python fstring', 'python', 'def greet(name):\n    return f"Hello {name}"'],

  // — JVM / .NET —————————————————————————————————————————
  ['java generics', 'java', 'List<String> names = new ArrayList<>();\nnames.add("a");\nfor (String n : names) {}'], // prettier-ignore
  ['java class', 'java', 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hi");\n    }\n}'], // prettier-ignore
  ['csharp property', 'c#', 'public class Foo {\n    public int Bar { get; set; }\n}'],
  ['csharp console', 'c#', 'using System;\n\nConsole.WriteLine("hello");'],
  ['kotlin main', 'kotlin', 'fun main() {\n    val list = listOf(1, 2, 3)\n    println(list.sum())\n}'], // prettier-ignore
  ['swift view', 'swift', 'struct ContentView: View {\n    var body: some View {\n        Text("Hi")\n    }\n}'], // prettier-ignore

  // — Systems ————————————————————————————————————————————
  ['go struct', 'go', 'type User struct {\n\tName string\n\tAge  int\n}'],
  ['go error check', 'go', 'if err != nil {\n\treturn nil, err\n}'],
  ['go func', 'go', 'func main() {\n\tfmt.Println("hi")\n}'],
  ['rust derive', 'rust', '#[derive(Debug)]\nstruct Point {\n    x: i32,\n    y: i32,\n}'],
  ['rust main', 'rust', 'fn main() {\n    let mut total = 0;\n    println!("{}", total);\n}'],
  ['c pointers', 'c', 'void swap(int *a, int *b) {\n    int t = *a;\n    *a = *b;\n    *b = t;\n}'], // prettier-ignore
  ['c include', 'c', '#include <stdio.h>\n\nint main(void) {\n    printf("hi\\n");\n    return 0;\n}'], // prettier-ignore
  ['cpp class', 'c++', 'class Widget {\npublic:\n    Widget();\nprivate:\n    int id_;\n};'],
  ['cpp iostream', 'c++', '#include <iostream>\n\nint main() {\n    std::cout << "hi" << std::endl;\n}'], // prettier-ignore

  // — Scripting ——————————————————————————————————————————
  ['php tag', 'php', '<?php\nfunction hello($name) {\n    echo "Hello $name";\n}'],
  ['ruby model', 'ruby', 'class User < ApplicationRecord\n  validates :name, presence: true\nend'], // prettier-ignore
  ['ruby block', 'ruby', 'items.each do |item|\n  puts item.name\nend'],
  ['shell commands', 'shell', 'cd /var/log\nls -la\ntail -f app.log'],
  ['shell pipe', 'shell', "ps aux | grep node | awk '{print $2}'"],
  ['shell script', 'shell', '#!/usr/bin/env bash\nset -euo pipefail\n\nfor f in *.txt; do\n  mv "$f" "$f.md"\ndone'], // prettier-ignore
  ['shell one path', 'shell', 'sh /app/echn/emallmng/bin/stopBack10088.sh'],

  // — Data / markup ——————————————————————————————————————
  ['json object', 'json', '{"name":"Xiangzi","enabled":true}'],
  ['json array', 'json', '[\n  { "id": 1 },\n  { "id": 2 }\n]'],
  ['json trailing comma', 'json', '{\n  "a": 1,\n}'],
  ['yaml workflow', 'yaml', 'name: CI\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest'], // prettier-ignore
  ['yaml document', 'yaml', '---\nversion: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /'], // prettier-ignore
  ['toml manifest', 'toml', '[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"'], // prettier-ignore
  ['css rule', 'css', '.btn:hover {\n  color: red;\n}'],
  ['css block', 'css', '.card {\n  display: flex;\n  padding: 12px;\n  border: 1px solid #eee;\n}'], // prettier-ignore
  ['scss nesting', 'scss', '$primary: #333;\n\n.btn {\n  &:hover {\n    color: $primary;\n  }\n}'], // prettier-ignore
  ['html fragment', 'html', '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>'],
  ['html attributes', 'html', '<div class="app">Hello</div>'],
  ['xml config', 'xml', '<config>\n  <item key="a">1</item>\n  <item key="b">2</item>\n</config>'], // prettier-ignore
  ['xml declaration', 'xml', '<?xml version="1.0"?>\n<root />'],
  ['sql join', 'sql', 'SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id;'],
  ['sql lowercase', 'sql', "select count(*) from events where created_at > now() - interval '1 day';"], // prettier-ignore
  ['sql ddl', 'sql', 'CREATE TABLE users (\n  id INT PRIMARY KEY,\n  name VARCHAR(64) NOT NULL\n);'], // prettier-ignore
  ['dockerfile', 'dockerfile', 'FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm ci'],
  ['diff hunk', 'diff', '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new'],
  ['markdown doc', 'markdown', '# Title\n\nSome text with a [link](https://example.com).\n\n- one\n- two'], // prettier-ignore

  // — Nested fence keeps its own tag ——————————————————————
  ['fenced rust', 'rust', '```rust\nfn main() {}\n```'],
  ['fenced alias', 'javascript', '```js\nlet a = 1\n```'],

  // — Abstain: not code, or too little evidence ———————————
  ['prose', '', 'This is a short note about the project.'],
  ['chinese prose', '', '这是一段普通的说明文字，用来描述这个功能的用途。'],
  ['empty', '', ''],
  ['log line', '', '2026-01-01 12:00:00 ERROR failed to connect: timeout after 30s'],
  ['stack trace', '', 'Traceback (most recent call last):\n  File "a.py", line 3, in <module>'],
  ['bare word', '', 'placeholder'],
  ['url', '', 'https://example.com/docs/getting-started'],
  ['csv row', '', 'id,name,email\n1,Ada,ada@example.com'],
  ['env dump', '', 'NODE_ENV=production\nPORT=3000'],
  ['prose heading list', '', 'Todo:\n- buy milk\n- call mom'],
  ['prose colon', '', 'Note: the build takes about 3 minutes on CI.'],
  ['version list', '', 'v2.0.37\nv2.0.36\nv2.0.35'],
  ['error message', '', "Error: Cannot find module 'react' at Object.<anonymous>"],

  // — Second pass: snippets held out while the weights were tuned ——————
  ['ts hook', 'typescript', 'const [count, setCount] = useState<number>(0)\nuseEffect(() => {\n  document.title = `${count}`\n}, [count])'], // prettier-ignore
  ['js config object', 'javascript', 'const config = {\n  port: 3000,\n  host: "localhost",\n}\nexport default config'], // prettier-ignore
  ['python decorator', 'python', '@app.route("/health")\ndef health():\n    return {"status": "ok"}'], // prettier-ignore
  ['python comprehension', 'python', 'squares = [x ** 2 for x in numbers if x > 0]\nprint(squares)'], // prettier-ignore
  ['java annotations', 'java', '@Service\npublic class UserService {\n    @Autowired\n    private UserRepository repo;\n}'], // prettier-ignore
  ['go handler', 'go', 'func handler(w http.ResponseWriter, r *http.Request) {\n\tfmt.Fprintf(w, "ok")\n}'], // prettier-ignore
  ['rust match', 'rust', 'match value {\n    Some(v) => println!("{}", v),\n    None => {}\n}'],
  ['csharp linq', 'c#', 'var adults = people.Where(p => p.Age >= 18).ToList();'],
  ['kotlin data class', 'kotlin', 'data class User(val id: Long, val name: String)'],
  ['swift async', 'swift', 'func fetch(id: Int) async throws -> User {\n    return try await api.get(id)\n}'], // prettier-ignore
  ['ruby hash', 'ruby', 'config = { host: "localhost", port: 3000 }\nputs config[:host]'],
  ['php method', 'php', 'class Cart {\n    public function total() {\n        return $this->sum;\n    }\n}'], // prettier-ignore
  ['shell docker run', 'shell', 'docker run -d --name web -p 8080:80 nginx:alpine'],
  ['shell git', 'shell', 'git checkout -b feat/x\ngit add .\ngit commit -m "wip"'],
  ['sql upsert', 'sql', "INSERT INTO users (id, name) VALUES (1, 'a')\nON CONFLICT (id) DO UPDATE SET name = excluded.name;"], // prettier-ignore
  ['yaml compose', 'yaml', 'services:\n  web:\n    image: nginx\n    ports:\n      - "80:80"'],
  ['yaml two keys', 'yaml', 'key: value\nother: 12'],
  ['css media query', 'css', '@media (max-width: 600px) {\n  .nav { display: none; }\n}'],
  ['scss mixin', 'scss', '@mixin flex-center {\n  display: flex;\n  align-items: center;\n}'],
  ['html form', 'html', '<form action="/login" method="post">\n  <input type="text" name="user">\n  <button>Go</button>\n</form>'], // prettier-ignore
  ['xml pom fragment', 'xml', '<dependency>\n  <groupId>org.junit</groupId>\n  <artifactId>junit</artifactId>\n</dependency>'], // prettier-ignore
  ['toml pyproject', 'toml', '[tool.ruff]\nline-length = 100\ntarget-version = "py311"'],
  ['dockerfile multi-stage', 'dockerfile', 'FROM golang:1.22 AS build\nRUN go build -o app\n\nFROM alpine\nCOPY --from=build /app /app'], // prettier-ignore
  ['markdown readme', 'markdown', '## Install\n\n```bash\nnpm i\n```\n\nSee the [docs](https://x.dev).'], // prettier-ignore
  ['c typedef', 'c', 'typedef struct {\n    char name[32];\n    int age;\n} Person;'],
  ['cpp template', 'c++', 'template <typename T>\nT max(T a, T b) {\n    return a > b ? a : b;\n}'], // prettier-ignore
  ['diff git header', 'diff', 'diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt'], // prettier-ignore

  // — Third pass: idioms the earlier passes had no signal for ——————————
  ['ts async signature', 'typescript', 'async function load(id: string): Promise<User | null> {\n  const res = await db.query(id)\n  return res ?? null\n}'], // prettier-ignore
  ['js class', 'javascript', 'class Queue {\n  constructor() {\n    this.items = []\n  }\n}'],
  ['js jquery', 'javascript', '$(document).ready(function () {\n  console.log("ready")\n})'],
  ['python django model', 'python', 'class Article(models.Model):\n    title = models.CharField(max_length=200)\n\n    def __str__(self):\n        return self.title'], // prettier-ignore
  ['python with open', 'python', 'with open("data.json") as fh:\n    data = json.load(fh)'],
  ['java stream', 'java', 'return items.stream().map(Item::getName).collect(Collectors.toList());'], // prettier-ignore
  ['go test', 'go', 'func TestAdd(t *testing.T) {\n\tif got := Add(1, 2); got != 3 {\n\t\tt.Fatalf("got %d", got)\n\t}\n}'], // prettier-ignore
  ['rust impl block', 'rust', 'impl Display for Point {\n    fn fmt(&self, f: &mut Formatter) -> fmt::Result {\n        write!(f, "({}, {})", self.x, self.y)\n    }\n}'], // prettier-ignore
  ['csharp controller', 'c#', '[HttpGet("{id}")]\npublic async Task<IActionResult> Get(int id) {\n    return Ok(await _repo.Find(id));\n}'], // prettier-ignore
  ['kotlin coroutine', 'kotlin', 'suspend fun load(): List<User> = withContext(Dispatchers.IO) {\n    api.fetchUsers()\n}'], // prettier-ignore
  ['swift closure', 'swift', 'let names = users.map { $0.name }.sorted()\nprint(names)'],
  ['ruby rake task', 'ruby', 'namespace :db do\n  task :seed do\n    puts "seeding"\n  end\nend'], // prettier-ignore
  ['php closure', 'php', '$items = array_map(function ($row) {\n    return $row["id"];\n}, $rows);'], // prettier-ignore
  ['shell find', 'shell', 'find . -name "*.log" -mtime +7 -delete'],
  ['shell if block', 'shell', 'if [ -f "$FILE" ]; then\n  echo "exists"\nfi'],
  ['sql cte', 'sql', "WITH recent AS (\n  SELECT * FROM orders WHERE created_at > now() - interval '7 days'\n)\nSELECT count(*) FROM recent;"], // prettier-ignore
  ['yaml kubernetes', 'yaml', 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 3'], // prettier-ignore
  ['css grid', 'css', '.layout {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 16px;\n}'], // prettier-ignore
  ['html table', 'html', '<table>\n  <tr><th>Name</th><td>Ada</td></tr>\n</table>'],
  ['xml namespaced', 'xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24" /></svg>'], // prettier-ignore
  ['toml inline table', 'toml', '[dependencies]\nserde = { version = "1", features = ["derive"] }'], // prettier-ignore
  ['c for loop', 'c', 'for (int i = 0; i < n; i++) {\n    sum += arr[i];\n}'],
  ['cpp vector', 'c++', 'std::vector<int> nums = {1, 2, 3};\nfor (auto n : nums) std::cout << n;'], // prettier-ignore
  ['dockerfile env', 'dockerfile', 'FROM python:3.12-slim\nENV PYTHONUNBUFFERED=1\nCMD ["python", "app.py"]'], // prettier-ignore
  ['markdown table', 'markdown', '| Name | Age |\n| --- | --- |\n| Ada | 36 |'],
  ['json nested', 'json', '{"user":{"id":1,"tags":["a","b"]}}'],
  ['prose sentence', '', 'The detector only tags a block when the evidence is strong enough.'],
  ['chinese with command', '', '使用 npm run dev 启动开发服务器，然后在浏览器打开 localhost。'],
  ['bare numbers', '', '1234\n5678'],
  ['quoted sentence', '', '"It works on my machine," they said.'],
  ['file listing', '', 'README.md\npackage.json\nsrc/index.ts'],

  // — Fourth pass: measured once before any of it was tuned against ——————
  ['ts satisfies', 'typescript', 'export const schema = z.object({\n  id: z.string(),\n}) satisfies Schema'], // prettier-ignore
  ['ts enum', 'typescript', 'enum Status {\n  Active = "active",\n  Archived = "archived",\n}'], // prettier-ignore
  ['js dom event', 'javascript', 'document.querySelector("#btn").addEventListener("click", () => {\n  alert("hi")\n})'], // prettier-ignore
  ['js node server', 'javascript', 'const http = require("http")\nhttp.createServer((req, res) => res.end("ok")).listen(3000)'], // prettier-ignore
  ['java enhanced for', 'java', 'for (Map.Entry<String, Integer> e : counts.entrySet()) {\n    System.out.println(e.getKey());\n}'], // prettier-ignore
  ['go range', 'go', 'nums := []int{1, 2, 3}\nfor i, n := range nums {\n\tfmt.Println(i, n)\n}'],
  ['rust vec', 'rust', 'let mut items: Vec<String> = Vec::new();\nitems.push(String::from("a"));'], // prettier-ignore
  ['csharp record', 'c#', 'public record User(int Id, string Name);\nConsole.WriteLine(new User(1, "a"));'], // prettier-ignore
  ['ruby each block', 'ruby', '[1, 2, 3].each do |n|\n  puts n * 2\nend'],
  ['shell curl', 'shell', 'curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/me | jq .'], // prettier-ignore
  ['shell npm', 'shell', 'npm ci\nnpm run build\nnpm test'],
  ['sql update', 'sql', "UPDATE orders SET status = 'shipped' WHERE id = 42;"],
  ['yaml ansible', 'yaml', '- name: install nginx\n  apt:\n    name: nginx\n    state: present'], // prettier-ignore
  ['css variables', 'css', ':root {\n  --brand: #0af;\n}\n\nbody {\n  color: var(--brand);\n}'], // prettier-ignore
  ['scss deep nesting', 'scss', '.card {\n  .title {\n    font-size: 14px;\n  }\n  &.is-active { color: red; }\n}'], // prettier-ignore
  ['html nav', 'html', '<nav class="menu">\n  <a href="/">Home</a>\n  <a href="/about">About</a>\n</nav>'], // prettier-ignore
  ['xml android layout', 'xml', '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:orientation="vertical" />'], // prettier-ignore
  ['toml build config', 'toml', '[build]\ncommand = "npm run build"\npublish = "dist"'],
  ['c malloc', 'c', 'char *buf = malloc(len + 1);\nif (buf == NULL) return -1;'],
  ['cpp auto iterator', 'c++', 'auto it = std::find(v.begin(), v.end(), target);\nif (it != v.end()) std::cout << *it;'], // prettier-ignore
  ['dockerfile arg', 'dockerfile', 'ARG NODE_VERSION=20\nFROM node:${NODE_VERSION}\nEXPOSE 3000'], // prettier-ignore
  ['markdown callout', 'markdown', '> **Note**\n> See the [guide](https://example.com) for details.'], // prettier-ignore
  ['json tsconfig', 'json', '{\n  "compilerOptions": {\n    "strict": true\n  }\n}'],
  ['diff context header', 'diff', '@@ -12,7 +12,7 @@ function main() {\n-  old();\n+  new();'],
  ['release note', '', 'Fixed a crash when pasting into an empty document.'],
  ['chinese ui text', '', '点击右上角的按钮即可导出 PDF 文件。'],
  ['key value prose', '', 'Status: still investigating the report from yesterday.'],
  ['name list', '', 'Ada Lovelace\nAlan Turing\nGrace Hopper'],
  ['timestamps', '', '2026-08-07 10:00\n2026-08-07 11:30'],
]

/**
 * Real languages the detector cannot yet see enough evidence for, so it abstains.
 * These are gaps, not desired behaviour — but asserting on them keeps a future
 * signal from turning an abstention into a confidently wrong fence.
 */
const knownGaps: readonly (readonly [name: string, snippet: string])[] = [
  ['python pandas', 'df = pd.read_csv("data.csv")\ndf["total"] = df["a"] + df["b"]\nprint(df.head())'], // prettier-ignore
  ['python try/except', 'try:\n    value = int(raw)\nexcept ValueError:\n    value = 0'],
  ['java record', 'public record Point(int x, int y) {}'],
  ['kotlin when', 'val label = when (status) {\n    1 -> "on"\n    else -> "off"\n}'],
  ['swift enum', 'enum Direction: String {\n    case north, south\n}'],
  ['php laravel route', 'Route::get("/users", function () {\n    return User::all();\n});'],
]

describe('pasted code language detection', () => {
  for (const [name, expected, snippet] of corpus) {
    it(`detects ${name}${expected ? ` as ${expected}` : ' as nothing'}`, () => {
      expect(detectCodeLanguage(snippet)?.value ?? '').toBe(expected)
    })
  }

  for (const [name, snippet] of knownGaps) {
    it(`abstains rather than guessing on ${name}`, () => {
      expect(detectCodeLanguage(snippet)).toBeNull()
    })
  }

  it('returns a label matching the fence value', () => {
    expect(detectCodeLanguage('SELECT id FROM users;')).toEqual({ value: 'sql', label: 'SQL' })
  })

  it('never returns a value that would break a fence info string', () => {
    for (const [, , snippet] of corpus) {
      const value = detectCodeLanguage(snippet)?.value
      if (value !== undefined) expect(value).not.toMatch(/\s/)
    }
  })
})
