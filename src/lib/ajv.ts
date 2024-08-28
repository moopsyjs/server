import Ajv from "ajv";

const ajv: Ajv = new Ajv();

ajv.addFormat("jsdate", function (date: unknown): boolean {
  return date != null && typeof date === "object" && date instanceof Date;
});

ajv.addFormat("date-time", function (date: unknown): boolean {
  return date != null && typeof date === "object" && date instanceof Date;
});

export { ajv };