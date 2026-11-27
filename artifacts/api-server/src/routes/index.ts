import { Router, type IRouter } from "express";
import healthRouter from "./health";
import noteToPlanRouter from "./notetoplan";

const router: IRouter = Router();

router.use(healthRouter);
router.use(noteToPlanRouter);

export default router;
