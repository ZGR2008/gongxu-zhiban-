import { Suspense } from "react";
import { recoverableLazy as lazy } from "../components/recoverable-lazy";
import type { PageProps } from "./WorkbenchShared";
import "./workbench.css";
const Missions = lazy(() => import("./Missions"));
const RunHistory = lazy(() => import("./RunHistory"));
const Delivery = lazy(() => import("./Delivery"));
export default function WorkbenchPages({
  path,
  ...props
}: PageProps & { path: string }) {
  return (
    <Suspense
      fallback={
        <div className="state-block" role="status">
          正在准备工作页面…
        </div>
      }
    >
      {path === "/runs" ? (
        <RunHistory {...props} />
      ) : path === "/delivery" ? (
        <Delivery {...props} />
      ) : (
        <Missions
          path={path}
          request={props.request}
          navigate={props.navigate}
        />
      )}
    </Suspense>
  );
}
