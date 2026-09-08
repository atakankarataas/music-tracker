import type { Metadata } from "next";

import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Giriş Yap",
};

export default function LoginPage() {
  return (
    <div className={styles["login-shell"]}>
      <div className={styles["login-card"]}>
        <div className={styles["login-header"]}>
          <div className={styles["login-logo"]}>
            <BrandMark size={24} />
          </div>
          <h1 className={styles["login-title"]}>
            atakan<span style={{ color: "var(--text-tertiary)" }}>.fm</span>
          </h1>
          <p className={styles["login-subtitle"]}>
            Devam etmek için giriş yapın
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
