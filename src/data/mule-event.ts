/**
 * Mule event walkthroughs for src/pages/revise/mule-event.astro: what payload, attributes, variables and the
 * error hold after each component. Written by hand from what the notes state (each step names the lesson it
 * comes from); the example values follow the demos in those lessons. Check a step against its lesson if unsure.
 */

export interface EventState {
  payload: string;
  attributes: string;
  /** variable name → value; {} = no variables; null = the lesson doesn't say */
  vars: Record<string, string> | null;
  /** the error object, when one has been raised */
  error?: string;
}

export interface EventStep {
  /** the component, as named in Anypoint Studio */
  component: string;
  /** what it does here, in a sentence or two */
  note: string;
  /** the event after this component */
  after: EventState;
  /** lesson that teaches it */
  src: string;
  /** heading of the section of that lesson's super-detailed notes it comes from, for a direct link */
  section?: string;
}

export interface Scenario {
  id: string;
  title: string;
  /** one line: what this walkthrough shows */
  sub: string;
  /** the lessons that teach what it shows (it appears in their Visual Practice) */
  lessons: string[];
  /** a similar walkthrough worth comparing it with, and what differs */
  compare?: { id: string; why: string };
  steps: EventStep[];
}

const REQ_ATTRS = 'HttpRequestAttributes\n  method: "GET"\n  queryParams: { empid: "123" }\n  uriParams: {}\n  headers: { host, user-agent, … }';
const POST_ATTRS = 'HttpRequestAttributes\n  method: "POST"\n  headers: { content-type: "application/json", … }';
const WEATHER = '{ "name": "Hyderabad", "main": { "temp_min": 299.1, … }, … }';
const RESP_ATTRS = "HttpResponseAttributes\n  statusCode: 200\n  headers: { … }";

export const SCENARIOS: Scenario[] = [
  {
    id: "request-to-response",
    lessons: ["day07"],
    title: "From HTTP request to response",
    sub: "How a request becomes a Mule event, and what a Database Select does to it.",
    steps: [
      {
        component: "HTTP Listener",
        note: "The request becomes a Mule event. The body goes into the payload; query params, URI params, headers, method and path go into the attributes. Variables start empty.",
        after: { payload: "(empty: a GET has no body)", attributes: REQ_ATTRS, vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "Set Variable",
        note: "employeeID = attributes.queryParams.empid. Set Variable creates one variable; it lives until the end of the event unless removed or overwritten.",
        after: { payload: "(empty: a GET has no body)", attributes: REQ_ATTRS, vars: { employeeID: '"123"' } },
        src: "day07",
        section: "7.3 Capabilities",
      },
      {
        component: "Database Select",
        note: "The payload is overwritten with the result (a Select always returns a list of rows, as Java). The attributes are lost. Variables are safe.",
        after: { payload: "[ { empid: 123, name: …, salary: … } ]  (Java)", attributes: "null", vars: { employeeID: '"123"' } },
        src: "day07",
        section: "5.1 What happened after the Database Select",
      },
      {
        component: "Transform Message",
        note: "Turns the Java result into JSON. Transform Message can write the payload, variables and attributes; here it writes the payload.",
        after: { payload: '[ { "empid": 123, "name": …, "salary": … } ]  (JSON)', attributes: "null", vars: { employeeID: '"123"' } },
        src: "day07",
        section: "7.3 Capabilities",
      },
      {
        component: "HTTP Listener (response)",
        note: "By default the Listener sends the payload as the response body with 200 OK. The variable was still there for any component that needed it.",
        after: { payload: 'sent as the body → 200 OK\n[ { "empid": 123, … } ]', attributes: "null", vars: { employeeID: '"123"' } },
        src: "day07",
        section: "8.3 Questions",
      },
    ],
  },
  {
    id: "http-request",
    lessons: ["day12"],
    compare: { id: "target-variable", why: "the same call with a target variable: the response goes into a variable instead" },
    title: "Calling another API",
    sub: "An HTTP Request overwrites payload and attributes, but never variables.",
    steps: [
      {
        component: "HTTP Listener",
        note: "A POST with a JSON body: the body is the payload.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "Set Variable",
        note: "request = payload. Saving the original request, because the next component will overwrite the payload.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: { request: '{ "city": "Hyderabad" }' } },
        src: "day12",
        section: "5. Propagation — What Gets Overwritten",
      },
      {
        component: "HTTP Request (weather API)",
        note: "Payload is overwritten by the response, attributes by the response's attributes. Variables are not overwritten.",
        after: { payload: WEATHER, attributes: RESP_ATTRS, vars: { request: '{ "city": "Hyderabad" }' } },
        src: "day12",
        section: "5. Propagation — What Gets Overwritten",
      },
      {
        component: "Transform Message",
        note: "Builds the answer from both: the city from vars.request.city, the temperatures from the payload.",
        after: { payload: '{ "city": "Hyderabad", "minTemp": 25.95, … }', attributes: RESP_ATTRS, vars: { request: '{ "city": "Hyderabad" }' } },
        src: "day12",
        section: "5. Propagation — What Gets Overwritten",
      },
    ],
  },
  {
    id: "target-variable",
    lessons: ["day12"],
    compare: { id: "http-request", why: "the same call without a target variable: payload and attributes are overwritten" },
    title: "HTTP Request with a target variable",
    sub: "With a target variable the response goes into a variable, and the payload and attributes stay as they were.",
    steps: [
      {
        component: "HTTP Listener",
        note: "The same POST request.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "HTTP Request (target variable: weatherResponse)",
        note: "Advanced tab → Target Variable: weatherResponse. The payload is unchanged, the attributes are the original request attributes, and the response is in a new variable.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: { weatherResponse: WEATHER } },
        src: "day12",
        section: "6.3 What happened",
      },
      {
        component: "Transform Message",
        note: "Reads both without a saved copy: payload.city and vars.weatherResponse.main.temp_min.",
        after: { payload: '{ "city": "Hyderabad", "minTemp": 25.95, … }', attributes: POST_ATTRS, vars: { weatherResponse: WEATHER } },
        src: "day12",
        section: "5. Propagation — What Gets Overwritten",
      },
    ],
  },
  {
    id: "flow-reference",
    lessons: ["day43"],
    compare: { id: "async", why: "Async instead: a copy runs and nothing comes back" },
    title: "Flow Reference",
    sub: "A Flow Reference passes the whole event to another flow and waits; what the child changes comes back.",
    steps: [
      {
        component: "HTTP Listener",
        note: "GET /flowref: no body.",
        after: { payload: "(empty)", attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "Flow Reference → child flow",
        note: "The whole Mule event (payload, attributes, variables) goes to the child flow, which runs Set Payload \"child flow payload\" and a Set Variable. The Flow Reference waits for it.",
        after: { payload: '"child flow payload"', attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: { fromChild: "(set in the child flow)" } },
        src: "day43",
        section: "5.1 Plain Flow Reference",
      },
      {
        component: "HTTP Listener (response)",
        note: "Back in the parent, the payload is the child's and its variable is visible: the response is 200 \"child flow payload\".",
        after: { payload: 'sent as the body → 200 OK\n"child flow payload"', attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: { fromChild: "(set in the child flow)" } },
        src: "day43",
        section: "5.1 Plain Flow Reference",
      },
    ],
  },
  {
    id: "async",
    lessons: ["day43"],
    compare: { id: "flow-reference", why: "a plain Flow Reference: it waits, and the child's changes come back" },
    title: "Async scope",
    sub: "Fire and forget: Async gets a copy of the event, and nothing it changes comes back.",
    steps: [
      {
        component: "HTTP Listener",
        note: "GET /async: no body.",
        after: { payload: "(empty)", attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "Async → Flow Reference → child flow",
        note: "A copy of the event goes into Async, and the same event continues straight to the next component. The child's payload and variables don't come back.",
        after: { payload: "(empty: unchanged)", attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day43",
        section: "5.2 Flow Reference inside Async",
      },
      {
        component: "Set Payload",
        note: "The main flow carries on with its own event, without waiting for the child.",
        after: { payload: '"main flow payload"', attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day43",
        section: "5.2 Flow Reference inside Async",
      },
    ],
  },
  {
    id: "for-each",
    lessons: ["day48"],
    compare: { id: "parallel-for-each", why: "Parallel For Each: the result overwrites the payload and variable changes don't come out" },
    title: "For Each",
    sub: "Inside the loop the payload is one item; after it, the original collection is back.",
    steps: [
      {
        component: "Set Payload",
        note: "The collection to loop over.",
        after: { payload: "[1, 2, 3, 4, 5]", attributes: "(from the source)", vars: {} },
        src: "day48",
        section: "7. Simple Demo — `[1,2,3,4,5] × 20`",
      },
      {
        component: "Set Variable",
        note: "total = 0, created before the loop.",
        after: { payload: "[1, 2, 3, 4, 5]", attributes: "(from the source)", vars: { total: "0" } },
        src: "day48",
        section: "10. Propagation Summary",
      },
      {
        component: "For Each (iteration 1)",
        note: "Collection #[payload]. Two variables are created as it starts: counter (the iteration number, from 1) and rootMessage (the original input). The payload is the current item.",
        after: { payload: "1", attributes: "(from the source)", vars: { total: "0", counter: "1", rootMessage: "[1, 2, 3, 4, 5]" } },
        src: "day48",
        section: "5.2 counter and rootMessage",
      },
      {
        component: "Set Payload / Set Variable (inside, iteration 1)",
        note: "Set Payload overwrites the payload inside the iteration (× 20); Set Variable updates total.",
        after: { payload: "20", attributes: "(from the source)", vars: { total: "20", counter: "1", rootMessage: "[1, 2, 3, 4, 5]" } },
        src: "day48",
        section: "7. Simple Demo — `[1,2,3,4,5] × 20`",
      },
      {
        component: "For Each (iteration 5)",
        note: "The last item. counter is 5.",
        after: { payload: "100", attributes: "(from the source)", vars: { total: "300", counter: "5", rootMessage: "[1, 2, 3, 4, 5]" } },
        src: "day48",
        section: "7. Simple Demo — `[1,2,3,4,5] × 20`",
      },
      {
        component: "After the For Each",
        note: "counter and rootMessage are removed automatically, and the payload is the original collection again. A variable created outside and changed inside keeps its changed value.",
        after: { payload: "[1, 2, 3, 4, 5]", attributes: "(from the source)", vars: { total: "300" } },
        src: "day48",
        section: "10. Propagation Summary",
      },
    ],
  },
  {
    id: "scatter-gather",
    lessons: ["day42"],
    title: "Scatter-Gather",
    sub: "Every route gets the same copy; the result is an object of Mule messages, one per route.",
    steps: [
      {
        component: "HTTP Listener",
        note: "The event that will be scattered.",
        after: { payload: '{ "empid": 120 }', attributes: POST_ATTRS, vars: { status: '"start"' } },
        src: "day42",
        section: "3. When to Use It",
      },
      {
        component: "Scatter-Gather: routes 0, 1 and 2 run",
        note: "Every route gets the same copy of payload, attributes and variables. Here routes 0 and 1 both set the variable status.",
        after: { payload: "(each route works on its own copy)", attributes: POST_ATTRS, vars: { status: '"start"' } },
        src: "day42",
        section: "3. When to Use It",
      },
      {
        component: "After the Scatter-Gather",
        note: "The payload is an object of objects, not an array: one Mule message per route, keyed from \"0\". A variable changed in two routes becomes a collection of the changed values.",
        after: { payload: '{\n  "0": { payload: …, attributes: … },\n  "1": { payload: …, attributes: … },\n  "2": { payload: …, attributes: … }\n}', attributes: POST_ATTRS, vars: { status: "[ value from route 0, value from route 1 ]" } },
        src: "day42",
        section: "6.1 The gathered output",
      },
    ],
  },
  {
    id: "on-error-propagate",
    lessons: ["day15", "day16"],
    compare: { id: "on-error-continue", why: "the same error caught with On Error Continue: a success response" },
    title: "An error with On Error Propagate",
    sub: "The error object appears only when an error is raised; Propagate sends an error response.",
    steps: [
      {
        component: "HTTP Listener",
        note: "A normal request.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "HTTP Request (fails: 404)",
        note: "The call fails, so an error is raised and the error object is created. The rest of the flow is skipped and the error handler runs.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND\ndescription: "HTTP GET on resource … failed: not found (404)."' },
        src: "day15",
        section: "5.1 When it exists",
      },
      {
        component: "On Error Propagate",
        note: "Runs its components, then propagates the error to the next level. In a Listener flow that is the source: the Listener sends its Error Response (500 by default).",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND\ndescription: "… not found (404)."\n→ error response, 500' },
        src: "day16",
        section: "4.1 Single flow",
      },
    ],
  },
  {
    id: "on-error-continue",
    lessons: ["day15", "day16"],
    compare: { id: "on-error-propagate", why: "the same error with On Error Propagate: an error response" },
    title: "An error with On Error Continue",
    sub: "Continue catches the error and sends a success response, with whatever payload is there.",
    steps: [
      {
        component: "HTTP Listener",
        note: "A normal request.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "HTTP Request (fails: 404)",
        note: "An error is raised and the error object is created.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND\ndescription: "… not found (404)."' },
        src: "day15",
        section: "5.1 When it exists",
      },
      {
        component: "On Error Continue",
        note: "Catches the error, runs its components and sends a success response: 200 OK. If no handler component sets the payload, whatever is there is sent, which is why the response shows the request's city.",
        after: { payload: 'sent as the body → 200 OK\n{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND (handled)' },
        src: "day16",
        section: "5.1 Meaning",
      },
    ],
  },
  {
    id: "parallel-for-each",
    lessons: ["day49"],
    compare: { id: "for-each", why: "the ordinary For Each: the payload is kept and variable changes come out" },
    title: "Parallel For Each",
    sub: "Iterations run at the same time; the aggregated result overwrites the payload, and variable changes don't come out.",
    steps: [
      {
        component: "Set Payload",
        note: "The demo's collection: numbers and strings, seven items (illustrative values).",
        after: { payload: '[1, 2, 3, 4, 5, "a", "b"]', attributes: "(from the source)", vars: {} },
        src: "day49",
        section: "10. The Parallel For Each Demo",
      },
      {
        component: "Set Variable",
        note: "outsidePFE, created before the scope.",
        after: { payload: '[1, 2, 3, 4, 5, "a", "b"]', attributes: "(from the source)", vars: { outsidePFE: "(its original value)" } },
        src: "day49",
        section: "10. The Parallel For Each Demo",
      },
      {
        component: "Parallel For Each (iterations running)",
        note: "Each item is processed on its own thread, in random order (the console showed 4, b, 5, 1, a; 5 threads). Inside: Set Variable insidePFE and Transform payload * 10. \"a\" * 10 fails; the Try's On Error Continue puts error.description in that item's payload.",
        after: { payload: "one item per thread, e.g. 4 → 40", attributes: "(from the source)", vars: { outsidePFE: "(its original value)", insidePFE: "(inside the iteration only)" } },
        src: "day49",
        section: "10. The Parallel For Each Demo",
      },
      {
        component: "After the Parallel For Each",
        note: "The aggregated response overwrites the payload: an array of Mule messages, one per iteration, in the order given. outsidePFE keeps its original value even if changed inside, and insidePFE is not accessible outside (using it gave a 500).",
        after: { payload: "[ { payload: 10, attributes: … }, { payload: 20, … }, …,\n  { payload: \"You called the function '*' with these arguments: …\" }, … ]", attributes: "(from the source)", vars: { outsidePFE: "(its original value: unchanged)" } },
        src: "day49",
        section: "8. For Each vs. Parallel For Each",
      },
    ],
  },
  {
    id: "batch-job",
    lessons: ["day50"],
    title: "Batch job",
    sub: "The main flow carries on with job information; each record is processed as its own payload, and On Complete gets a result summary.",
    steps: [
      {
        component: "Set Payload",
        note: "The demo's eight records.",
        after: { payload: '[1, 2, 3, 4, 5, "a", "b", 6]', attributes: "(from the source)", vars: null },
        src: "day50",
        section: "6. Components",
      },
      {
        component: "Batch Job (main flow)",
        note: "Batch is asynchronous: it doesn't overwrite the main flow's payload with the results. After the Batch Job the payload showed the job instance info.",
        after: { payload: "batch job instance info\n  record count: 8, status: executing, …", attributes: "(from the source)", vars: null },
        src: "day50",
        section: "7.2 The main flow's payload",
      },
      {
        component: "Batch Step (one record)",
        note: "Inside a step the payload is one record. Set Payload payload * 20: record 4 becomes 80. \"a\" * 20 fails, so that record is marked failed.",
        after: { payload: "80  (record 4 × 20)", attributes: "(not covered in the lesson)", vars: null },
        src: "day50",
        section: "10. The Demo",
      },
      {
        component: "Batch Aggregator (size 4)",
        note: "Every 4 successful records are passed on together; failed records never reach the aggregator. The demo logged [20, 40, 80, 100]; the last call had only 2.",
        after: { payload: "[20, 40, 80, 100]", attributes: "(not covered in the lesson)", vars: null },
        src: "day50",
        section: "9. Batch Aggregator",
      },
      {
        component: "On Complete",
        note: "Runs once, after all records. Its payload is a BatchJobResult. In the run discussed in class: 8 processed, 6 successful, 2 failed (\"a\" and \"b\").",
        after: { payload: "BatchJobResult\n  loadedRecords: 8\n  processedRecords: 8\n  successfulRecords: 6\n  failedRecords: 2\n  elapsedTimeInMillis: …", attributes: "(not covered in the lesson)", vars: null },
        src: "day50",
        section: "10.2 On Complete result",
      },
    ],
  },
  {
    id: "jms",
    lessons: ["day51"],
    title: "JMS publish and consume",
    sub: "Publishing keeps the payload; the consuming flow starts a new event with the body as payload and the JMS headers as attributes.",
    steps: [
      {
        component: "HTTP Listener (/publish)",
        note: "A JSON message to publish (the demo used an employee ID, name and designation; values illustrative).",
        after: { payload: '{ "empId": …, "name": …, "designation": … }', attributes: 'HttpRequestAttributes\n  method: "POST"\n  …', vars: {} },
        src: "day51",
        section: "11. Demo — Publish to the Queue",
      },
      {
        component: "JMS Publish (queue q.test)",
        note: "The message goes to the queue (it shows 1 pending message). The payload after Publish is not overwritten: it stays the same.",
        after: { payload: '{ "empId": …, "name": …, "designation": … }', attributes: 'HttpRequestAttributes\n  method: "POST"\n  …', vars: {} },
        src: "day51",
        section: "11. Demo — Publish to the Queue",
      },
      {
        component: "JMS On New Message (consuming flow)",
        note: "A new event in another flow: JMS headers go into the attributes and the body into the payload. The consumed message arrived as a String whose content was JSON. Each message has an acknowledgement ID, attributes.ackId.",
        after: { payload: '"{ \\"empId\\": …, \\"name\\": …, … }"  (a String)', attributes: "JMS attributes\n  headers: { … }\n  ackId: …", vars: {} },
        src: "day51",
        section: "5. Message Structure",
      },
      {
        component: "Transform Message: read(payload, \"application/json\")",
        note: "read turns the String into a JSON object so its fields can be used.",
        after: { payload: '{ "empId": …, "name": …, "designation": … }  (JSON)', attributes: "JMS attributes\n  headers: { … }\n  ackId: …", vars: {} },
        src: "day51",
        section: "12. `read` and `write`",
      },
    ],
  },
  {
    id: "try-scope",
    lessons: ["day16"],
    compare: { id: "on-error-continue", why: "the same error handled at flow level: the rest of the flow doesn't run" },
    title: "Try scope with On Error Continue",
    sub: "An error inside a Try is handled inside it, and the flow carries on after the Try.",
    steps: [
      {
        component: "HTTP Listener",
        note: "A normal request.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
        section: "2.4 How HTTP parts map into the Mule event",
      },
      {
        component: "Try → HTTP Request (weather) fails",
        note: "The call inside the Try fails: an error is raised and the error object is created. The rest of the Try (the Transform Message) is skipped.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: "errorType: HTTP:…\ndescription: \"…\"" },
        src: "day16",
        section: "8.2 Component level — Try scope",
      },
      {
        component: "Try's On Error Continue → Logger(error.description)",
        note: "The Try's own handler catches the error and logs error.description. It could even be empty: it just swallows the error and continues.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: "errorType: HTTP:… (handled)" },
        src: "day16",
        section: "8.2 Component level — Try scope",
      },
      {
        component: "Logger (after the Try)",
        note: "The flow continues even though the Try's components failed. No handler set the payload, so it is whatever was there.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {} },
        src: "day16",
        section: "8.2 Component level — Try scope",
      },
    ],
  },
];

export type Part = "payload" | "attributes" | "vars" | "error";
const PARTS: Part[] = ["payload", "attributes", "vars", "error"];
const value = (s: EventState, p: Part) => (p === "vars" ? JSON.stringify(s.vars) : (s[p] ?? ""));
/** the parts of the event that differ between two states (for the first state: everything it has) */
export const changedParts = (before: EventState | undefined, after: EventState): Part[] =>
  PARTS.filter((p) => (before ? value(before, p) !== value(after, p) : p !== "error" || !!after.error));
