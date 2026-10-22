/**
 * Mule event walkthroughs for src/pages/revise/mule-event.astro: what payload, attributes, variables and the
 * error hold after each component. Written by hand from what the notes state (each step names the lesson it
 * comes from); the example values follow the demos in those lessons. Check a step against its lesson if unsure.
 */

export interface EventState {
  payload: string;
  attributes: string;
  /** variable name → value; {} = no variables */
  vars: Record<string, string>;
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
}

export interface Scenario {
  id: string;
  title: string;
  /** one line: what this walkthrough shows */
  sub: string;
  steps: EventStep[];
}

const REQ_ATTRS = 'HttpRequestAttributes\n  method: "GET"\n  queryParams: { empid: "123" }\n  uriParams: {}\n  headers: { host, user-agent, … }';
const POST_ATTRS = 'HttpRequestAttributes\n  method: "POST"\n  headers: { content-type: "application/json", … }';
const WEATHER = '{ "name": "Hyderabad", "main": { "temp_min": 299.1, … }, … }';
const RESP_ATTRS = "HttpResponseAttributes\n  statusCode: 200\n  headers: { … }";

export const SCENARIOS: Scenario[] = [
  {
    id: "request-to-response",
    title: "From HTTP request to response",
    sub: "How a request becomes a Mule event, and what a Database Select does to it.",
    steps: [
      {
        component: "HTTP Listener",
        note: "The request becomes a Mule event. The body goes into the payload; query params, URI params, headers, method and path go into the attributes. Variables start empty.",
        after: { payload: "(empty: a GET has no body)", attributes: REQ_ATTRS, vars: {} },
        src: "day07",
      },
      {
        component: "Set Variable",
        note: "employeeID = attributes.queryParams.empid. Set Variable creates one variable; it lives until the end of the event unless removed or overwritten.",
        after: { payload: "(empty: a GET has no body)", attributes: REQ_ATTRS, vars: { employeeID: '"123"' } },
        src: "day07",
      },
      {
        component: "Database Select",
        note: "The payload is overwritten with the result (a Select always returns a list of rows, as Java). The attributes are lost. Variables are safe.",
        after: { payload: "[ { empid: 123, name: …, salary: … } ]  (Java)", attributes: "null", vars: { employeeID: '"123"' } },
        src: "day07",
      },
      {
        component: "Transform Message",
        note: "Turns the Java result into JSON. Transform Message can write the payload, variables and attributes; here it writes the payload.",
        after: { payload: '[ { "empid": 123, "name": …, "salary": … } ]  (JSON)', attributes: "null", vars: { employeeID: '"123"' } },
        src: "day07",
      },
      {
        component: "HTTP Listener (response)",
        note: "By default the Listener sends the payload as the response body with 200 OK. The variable was still there for any component that needed it.",
        after: { payload: 'sent as the body → 200 OK\n[ { "empid": 123, … } ]', attributes: "null", vars: { employeeID: '"123"' } },
        src: "day07",
      },
    ],
  },
  {
    id: "http-request",
    title: "Calling another API",
    sub: "An HTTP Request overwrites payload and attributes, but never variables.",
    steps: [
      {
        component: "HTTP Listener",
        note: "A POST with a JSON body: the body is the payload.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
      },
      {
        component: "Set Variable",
        note: "request = payload. Saving the original request, because the next component will overwrite the payload.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: { request: '{ "city": "Hyderabad" }' } },
        src: "day12",
      },
      {
        component: "HTTP Request (weather API)",
        note: "Payload is overwritten by the response, attributes by the response's attributes. Variables are not overwritten.",
        after: { payload: WEATHER, attributes: RESP_ATTRS, vars: { request: '{ "city": "Hyderabad" }' } },
        src: "day12",
      },
      {
        component: "Transform Message",
        note: "Builds the answer from both: the city from vars.request.city, the temperatures from the payload.",
        after: { payload: '{ "city": "Hyderabad", "minTemp": 25.95, … }', attributes: RESP_ATTRS, vars: { request: '{ "city": "Hyderabad" }' } },
        src: "day12",
      },
    ],
  },
  {
    id: "target-variable",
    title: "HTTP Request with a target variable",
    sub: "With a target variable the response goes into a variable, and the payload and attributes stay as they were.",
    steps: [
      {
        component: "HTTP Listener",
        note: "The same POST request.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
      },
      {
        component: "HTTP Request (target variable: weatherResponse)",
        note: "Advanced tab → Target Variable: weatherResponse. The payload is unchanged, the attributes are the original request attributes, and the response is in a new variable.",
        after: { payload: '{ "city": "Hyderabad" }', attributes: POST_ATTRS, vars: { weatherResponse: WEATHER } },
        src: "day12",
      },
      {
        component: "Transform Message",
        note: "Reads both without a saved copy: payload.city and vars.weatherResponse.main.temp_min.",
        after: { payload: '{ "city": "Hyderabad", "minTemp": 25.95, … }', attributes: POST_ATTRS, vars: { weatherResponse: WEATHER } },
        src: "day12",
      },
    ],
  },
  {
    id: "flow-reference",
    title: "Flow Reference",
    sub: "A Flow Reference passes the whole event to another flow and waits; what the child changes comes back.",
    steps: [
      {
        component: "HTTP Listener",
        note: "GET /flowref: no body.",
        after: { payload: "(empty)", attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day07",
      },
      {
        component: "Flow Reference → child flow",
        note: "The whole Mule event (payload, attributes, variables) goes to the child flow, which runs Set Payload \"child flow payload\" and a Set Variable. The Flow Reference waits for it.",
        after: { payload: '"child flow payload"', attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: { fromChild: "(set in the child flow)" } },
        src: "day43",
      },
      {
        component: "HTTP Listener (response)",
        note: "Back in the parent, the payload is the child's and its variable is visible: the response is 200 \"child flow payload\".",
        after: { payload: 'sent as the body → 200 OK\n"child flow payload"', attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: { fromChild: "(set in the child flow)" } },
        src: "day43",
      },
    ],
  },
  {
    id: "async",
    title: "Async scope",
    sub: "Fire and forget: Async gets a copy of the event, and nothing it changes comes back.",
    steps: [
      {
        component: "HTTP Listener",
        note: "GET /async: no body.",
        after: { payload: "(empty)", attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day07",
      },
      {
        component: "Async → Flow Reference → child flow",
        note: "A copy of the event goes into Async, and the same event continues straight to the next component. The child's payload and variables don't come back.",
        after: { payload: "(empty: unchanged)", attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day43",
      },
      {
        component: "Set Payload",
        note: "The main flow carries on with its own event, without waiting for the child.",
        after: { payload: '"main flow payload"', attributes: 'HttpRequestAttributes\n  method: "GET"\n  …', vars: {} },
        src: "day43",
      },
    ],
  },
  {
    id: "for-each",
    title: "For Each",
    sub: "Inside the loop the payload is one item; after it, the original collection is back.",
    steps: [
      {
        component: "Set Payload",
        note: "The collection to loop over.",
        after: { payload: "[1, 2, 3, 4, 5]", attributes: "(from the source)", vars: {} },
        src: "day48",
      },
      {
        component: "Set Variable",
        note: "total = 0, created before the loop.",
        after: { payload: "[1, 2, 3, 4, 5]", attributes: "(from the source)", vars: { total: "0" } },
        src: "day48",
      },
      {
        component: "For Each (iteration 1)",
        note: "Collection #[payload]. Two variables are created as it starts: counter (the iteration number, from 1) and rootMessage (the original input). The payload is the current item.",
        after: { payload: "1", attributes: "(from the source)", vars: { total: "0", counter: "1", rootMessage: "[1, 2, 3, 4, 5]" } },
        src: "day48",
      },
      {
        component: "Set Payload / Set Variable (inside, iteration 1)",
        note: "Set Payload overwrites the payload inside the iteration (× 20); Set Variable updates total.",
        after: { payload: "20", attributes: "(from the source)", vars: { total: "20", counter: "1", rootMessage: "[1, 2, 3, 4, 5]" } },
        src: "day48",
      },
      {
        component: "For Each (iteration 5)",
        note: "The last item. counter is 5.",
        after: { payload: "100", attributes: "(from the source)", vars: { total: "300", counter: "5", rootMessage: "[1, 2, 3, 4, 5]" } },
        src: "day48",
      },
      {
        component: "After the For Each",
        note: "counter and rootMessage are removed automatically, and the payload is the original collection again. A variable created outside and changed inside keeps its changed value.",
        after: { payload: "[1, 2, 3, 4, 5]", attributes: "(from the source)", vars: { total: "300" } },
        src: "day48",
      },
    ],
  },
  {
    id: "scatter-gather",
    title: "Scatter-Gather",
    sub: "Every route gets the same copy; the result is an object of Mule messages, one per route.",
    steps: [
      {
        component: "HTTP Listener",
        note: "The event that will be scattered.",
        after: { payload: '{ "empid": 120 }', attributes: POST_ATTRS, vars: { status: '"start"' } },
        src: "day42",
      },
      {
        component: "Scatter-Gather: routes 0, 1 and 2 run",
        note: "Every route gets the same copy of payload, attributes and variables. Here routes 0 and 1 both set the variable status.",
        after: { payload: "(each route works on its own copy)", attributes: POST_ATTRS, vars: { status: '"start"' } },
        src: "day42",
      },
      {
        component: "After the Scatter-Gather",
        note: "The payload is an object of objects, not an array: one Mule message per route, keyed from \"0\". A variable changed in two routes becomes a collection of the changed values.",
        after: { payload: '{\n  "0": { payload: …, attributes: … },\n  "1": { payload: …, attributes: … },\n  "2": { payload: …, attributes: … }\n}', attributes: POST_ATTRS, vars: { status: "[ value from route 0, value from route 1 ]" } },
        src: "day42",
      },
    ],
  },
  {
    id: "on-error-propagate",
    title: "An error with On Error Propagate",
    sub: "The error object appears only when an error is raised; Propagate sends an error response.",
    steps: [
      {
        component: "HTTP Listener",
        note: "A normal request.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
      },
      {
        component: "HTTP Request (fails: 404)",
        note: "The call fails, so an error is raised and the error object is created. The rest of the flow is skipped and the error handler runs.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND\ndescription: "HTTP GET on resource … failed: not found (404)."' },
        src: "day15",
      },
      {
        component: "On Error Propagate",
        note: "Runs its components, then propagates the error to the next level. In a Listener flow that is the source: the Listener sends its Error Response (500 by default).",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND\ndescription: "… not found (404)."\n→ error response, 500' },
        src: "day16",
      },
    ],
  },
  {
    id: "on-error-continue",
    title: "An error with On Error Continue",
    sub: "Continue catches the error and sends a success response, with whatever payload is there.",
    steps: [
      {
        component: "HTTP Listener",
        note: "A normal request.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {} },
        src: "day07",
      },
      {
        component: "HTTP Request (fails: 404)",
        note: "An error is raised and the error object is created.",
        after: { payload: '{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND\ndescription: "… not found (404)."' },
        src: "day15",
      },
      {
        component: "On Error Continue",
        note: "Catches the error, runs its components and sends a success response: 200 OK. If no handler component sets the payload, whatever is there is sent, which is why the response shows the request's city.",
        after: { payload: 'sent as the body → 200 OK\n{ "city": "Mumbai" }', attributes: POST_ATTRS, vars: {}, error: 'errorType: HTTP:NOT_FOUND (handled)' },
        src: "day16",
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
