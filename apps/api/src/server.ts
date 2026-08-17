import { buildApp } from "./app";
import { env } from "./config/env";

const app = buildApp({ logger: true });

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
