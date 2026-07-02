// With the Typeflow Bun plugin preloaded, `.typeflow` files import as mapping functions.
// With `allowArbitraryExtensions` in tsconfig, the generated `user.d.typeflow.ts`
// makes this import fully typed: mapUser is (input: Input) => Output.
import mapUser, { type Input } from "../api-response/user.typeflow";
import sample from "../api-response/sample.json";

// resolveJsonModule widens "admin" to string, so assert the JSON against the mapping's Input type.
const view = mapUser(sample as Input);
console.log(view.fullName, "->", view.activeTags.join(", "));
