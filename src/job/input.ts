export type JobInput =
  | { type: "text"; content: string }
  | { type: "file"; path: string }
  | { type: "url"; url: string };

export type RawJobContent = {
  content: string;
  source: {
    type: JobInput["type"];
    value: string;
  };
};
