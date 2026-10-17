// O que a tela diz quando a API recusa: o catálogo único da casa (src/lib/errors.js, de
// erros-e-mensagens.md), nunca o texto cru do servidor (história 1.5).
import { staffProblem } from "../../../lib/errors.js";

/** { title, message } para qualquer falha: ApiError, rede ou defeito. */
export const problemText = (error, variant) => staffProblem(error, { variant });
