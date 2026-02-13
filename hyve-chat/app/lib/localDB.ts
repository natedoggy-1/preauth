// app/lib/localDB.ts
import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";

export interface PatientPHI {
  patient_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  dob: string; // YYYY-MM-DD
  insurance_member_id?: string;
  insurance_group_number?: string;
}

export class LocalPHIDatabase {
  private db: any | null = null;

  // Web fallback store
  private mem = new Map<string, PatientPHI>();

  // Ensure init completes before queries run
  private ready: Promise<void>;

  constructor() {
    if (Platform.OS === "web") {
      this.ready = Promise.resolve();
      return;
    }

    this.db = (SQLite as any).openDatabase?.("phi.db") ?? null;

    if (!this.db) {
      this.ready = Promise.reject(
        new Error(
          "expo-sqlite openDatabase() is unavailable. Ensure expo-sqlite is installed and the app is running on iOS/Android."
        )
      );
      return;
    }

    this.ready = this.initDatabase();
  }

  private async initDatabase(): Promise<void> {
    if (!this.db) return;

    return new Promise<void>((resolve, reject) => {
      this.db.transaction((tx: any) => {
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS patients (
            patient_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            dob TEXT NOT NULL,
            insurance_member_id TEXT,
            insurance_group_number TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );`,
          [],
          () => resolve(),
          (_: any, error: any) => {
            reject(error);
            return false;
          }
        );
      });
    });
  }

  async getPatientPHI(patientId: string): Promise<PatientPHI | null> {
    await this.ready;

    if (!this.db) {
      return this.mem.get(patientId) ?? null;
    }

    return new Promise((resolve, reject) => {
      this.db.transaction((tx: any) => {
        tx.executeSql(
          "SELECT * FROM patients WHERE patient_id = ?",
          [patientId],
          (_: any, { rows }: any) => {
            resolve(rows.length === 0 ? null : (rows.item(0) as PatientPHI));
          },
          (_: any, error: any) => {
            reject(error);
            return false;
          }
        );
      });
    });
  }

  async storePatientPHI(patient: PatientPHI): Promise<void> {
    await this.ready;

    if (!this.db) {
      this.mem.set(patient.patient_id, patient);
      return;
    }

    return new Promise((resolve, reject) => {
      this.db.transaction((tx: any) => {
        tx.executeSql(
          `INSERT OR REPLACE INTO patients
           (patient_id, full_name, first_name, last_name, dob,
            insurance_member_id, insurance_group_number)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            patient.patient_id,
            patient.full_name,
            patient.first_name,
            patient.last_name,
            patient.dob,
            patient.insurance_member_id || null,
            patient.insurance_group_number || null,
          ],
          () => resolve(),
          (_: any, error: any) => {
            reject(error);
            return false;
          }
        );
      });
    });
  }

  async searchPatients(query: string): Promise<PatientPHI[]> {
    await this.ready;

    const lowerQuery = (query ?? "").trim().toLowerCase();

    // ✅ Web fallback
    if (!this.db) {
      const all = Array.from(this.mem.values());
      if (!lowerQuery) return all.slice(0, 10);

      return all
        .filter((p) => {
          return (
            p.full_name?.toLowerCase().includes(lowerQuery) ||
            p.first_name?.toLowerCase().includes(lowerQuery) ||
            p.last_name?.toLowerCase().includes(lowerQuery)
          );
        })
        .slice(0, 10);
    }

    // ✅ Native: empty search returns latest
    if (!lowerQuery) {
      return new Promise((resolve, reject) => {
        this.db.transaction((tx: any) => {
          tx.executeSql(
            `SELECT * FROM patients
             ORDER BY created_at DESC
             LIMIT 10`,
            [],
            (_: any, { rows }: any) => {
              const results: PatientPHI[] = [];
              for (let i = 0; i < rows.length; i++) results.push(rows.item(i));
              resolve(results);
            },
            (_: any, error: any) => {
              reject(error);
              return false;
            }
          );
        });
      });
    }

    return new Promise((resolve, reject) => {
      this.db.transaction((tx: any) => {
        tx.executeSql(
          `SELECT * FROM patients
           WHERE LOWER(full_name) LIKE ?
              OR LOWER(first_name) LIKE ?
              OR LOWER(last_name) LIKE ?
           LIMIT 10`,
          [`%${lowerQuery}%`, `%${lowerQuery}%`, `%${lowerQuery}%`],
          (_: any, { rows }: any) => {
            const results: PatientPHI[] = [];
            for (let i = 0; i < rows.length; i++) results.push(rows.item(i));
            resolve(results);
          },
          (_: any, error: any) => {
            reject(error);
            return false;
          }
        );
      });
    });
  }
}
