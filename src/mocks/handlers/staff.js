// Rotas da equipe que vêm antes das rotas das áreas: a entrada (login, links, sessões, o
// aparelho da casa e o PIN dele) e a guarda que lê a sessão de toda chamada da equipe, como o
// middleware do servidor. ?papel= ainda escolhe quem está dentro sem entrar (veja scenario.js); com
// ninguém dentro, a API responde 401 como a real responde a um visitante sem sessão.
import { authHandlers } from "./staff/auth.js";

export const staffHandlers = [...authHandlers];
