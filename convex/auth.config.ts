import { authKit } from "./auth";

const authConfig = {
  providers: authKit ? authKit.getAuthConfigProviders() : [],
};

export default authConfig;
