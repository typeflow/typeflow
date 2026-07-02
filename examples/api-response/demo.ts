import { fileURLToPath } from "node:url";
import { typeToString } from "@thomasfarineau/typeflow-core";
import { compileTypeflowFile, createMapping } from "@thomasfarineau/typeflow";
import sample from "./sample.json";

const file = fileURLToPath(new URL("./user.typeflow", import.meta.url));

const result = await compileTypeflowFile(file);
if (!result.ok || !result.compiled) {
  console.error("Compilation failed", result.diagnostics);
  process.exit(1);
}

console.log("Inferred output type:\n");
console.log(typeToString(result.outputType!));
console.log("\nTransformed output:\n");
const mapUser = createMapping(result.compiled);
console.log(JSON.stringify(mapUser(sample), null, 2));
