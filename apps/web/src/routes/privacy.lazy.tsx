import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Video } from "lucide-react";

export const Route = createLazyFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-neutral-500 transition-colors hover:text-accent-700"
          >
            <ArrowLeft size={16} />
            <Video size={20} className="text-accent-700" />
            <span className="font-bold text-primary-950">OSSMeet</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl animate-fade-in px-6 py-16">
        <h1 className="text-2xl font-bold text-neutral-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Last updated: April 22, 2026
        </p>

        <div className="mt-10 space-y-10 text-neutral-700 leading-relaxed">
          {/* 1. Introduction */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              1. Introduction
            </h2>
            <p className="mt-3">
              Welcome to OSSMeet (&quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;). OSSMeet is an open-source video meeting platform
              available at{" "}
              <a
                href="https://ossmeet.com"
                className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
              >
                ossmeet.com
              </a>
              . This Privacy Policy explains how we collect, use, store, and
              protect your personal information when you use our services. By
              using OSSMeet, you agree to the practices described in this policy.
            </p>
          </section>

          {/* 2. Information We Collect */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              2. Information We Collect
            </h2>

            <h3 className="mt-4 font-medium text-neutral-900">
              2.1 Account Information
            </h3>
            <p className="mt-2">
              When you sign in with Google OAuth, we collect the following from
              your Google account:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Google account identifier (sub ID)</li>
              <li>Email address</li>
              <li>Display name</li>
              <li>Profile picture URL</li>
            </ul>

            <h3 className="mt-4 font-medium text-neutral-900">
              2.2 Meeting Data
            </h3>
            <p className="mt-2">
              We do not have access to the content of your meetings. Your audio,
              video, recordings, transcripts, whiteboard sessions, and uploaded
              files are yours — we do not monitor, review, or access them.
            </p>
            <p className="mt-2">
              We do collect meeting <strong>metadata</strong> to operate the
              service, such as:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Room names and meeting codes</li>
              <li>Space membership and participant counts</li>
              <li>Meeting start and end times</li>
              <li>Storage usage per account</li>
            </ul>

            <h3 className="mt-4 font-medium text-neutral-900">
              2.3 Technical Data
            </h3>
            <p className="mt-2">
              We automatically collect certain technical information to maintain
              security and improve the service:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>IP address</li>
              <li>User agent (browser and operating system information)</li>
              <li>Session timestamps and expiry information</li>
            </ul>

            <h3 className="mt-4 font-medium text-neutral-900">
              2.4 Cookies
            </h3>
            <p className="mt-2">OSSMeet uses the following cookies:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>session</strong> — An HttpOnly authentication cookie
                used to keep you signed in.
              </li>
              <li>
                <strong>oauth_state</strong> — A temporary cookie used during
                the Google OAuth sign-in flow for PKCE state verification.
                Deleted after authentication completes.
              </li>
              <li>
                <strong>ossmeet_guest_*</strong> — Temporary cookies that grant
                guests access to a specific meeting without requiring an
                account.
              </li>
            </ul>
            <p className="mt-2">
              We do not use any third-party analytics cookies, advertising
              trackers, or tracking pixels.
            </p>
          </section>

          {/* 3. How We Use Your Information */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              3. How We Use Your Information
            </h2>
            <p className="mt-3">
              We use the information we collect for the following purposes:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Authenticating your identity and managing your account</li>
              <li>
                Operating the meeting infrastructure and delivering real-time
                audio, video, and collaboration features
              </li>
              <li>
                Managing spaces, rooms, and participant access within your
                organization
              </li>
              <li>
                Processing billing and subscription management through our
                payment provider
              </li>
              <li>
                Maintaining security, preventing abuse, and debugging technical
                issues
              </li>
            </ul>
          </section>

          {/* 4. Data Storage & Security */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              4. Data Storage &amp; Security
            </h2>
            <p className="mt-3">
              OSSMeet is deployed on Cloudflare&apos;s infrastructure. Your data
              is stored as follows:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Structured data</strong> (users, sessions, spaces,
                rooms, meetings, transcripts) is stored in Cloudflare D1, a
                globally distributed SQLite database.
              </li>
              <li>
                <strong>Files</strong> (recordings, whiteboard snapshots,
                uploaded PDFs) are stored in Cloudflare R2 object storage.
              </li>
              <li>
                <strong>Session tokens</strong> are stored as cryptographic
                hashes — we never store your raw session token.
              </li>
            </ul>
            <p className="mt-3">
              All connections to OSSMeet are encrypted in transit via TLS. We
              follow industry-standard security practices to protect your data,
              including encrypted session storage, scoped access controls, and
              automatic session expiry. While no system can guarantee absolute
              security, we are committed to protecting your information.
            </p>
          </section>

          {/* 5. Third-Party Services */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              5. Third-Party Services
            </h2>
            <p className="mt-3">
              OSSMeet integrates with the following third-party services to
              provide its functionality:
            </p>
            <ul className="mt-3 list-disc space-y-3 pl-6">
              <li>
                <strong>Google OAuth</strong> — Used for authentication. When
                you sign in, Google shares your basic profile information with
                us. Google&apos;s use of your data is governed by{" "}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
                >
                  Google&apos;s Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>Google Gemini AI</strong> — When you use AI-powered
                meeting features (such as notes or summaries), relevant meeting
                data (e.g., transcript text) is sent to Google&apos;s Gemini API
                for processing. This data is handled according to{" "}
                <a
                  href="https://ai.google.dev/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
                >
                  Google&apos;s AI Terms of Service
                </a>
                .
              </li>
              <li>
                <strong>LiveKit (self-hosted)</strong> — We run our own LiveKit
                instance on dedicated infrastructure to provide real-time
                WebRTC audio, video, and screen sharing. Media streams are
                routed through our servers during meetings and are not sent to
                any third party. LiveKit does not permanently store your media.
              </li>
              <li>
                <strong>Cloudflare</strong> — Provides our compute (Workers),
                database (D1), object storage (R2), and content delivery
                infrastructure. Data may be processed at Cloudflare edge
                locations worldwide. See{" "}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
                >
                  Cloudflare&apos;s Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>Paddle</strong> — Handles subscription billing
                and payment processing. We do not store your credit card
                information directly; it is managed by Paddle. See{" "}
                <a
                  href="https://www.paddle.com/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
                >
                  Paddle&apos;s Privacy Policy
                </a>
                .
              </li>
            </ul>
          </section>

          {/* 6. Data Retention */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              6. Data Retention
            </h2>
            <p className="mt-3">
              Meeting content stored on your behalf (such as recordings or
              files) is retained according to your subscription plan:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Free plan:</strong> 30 days from creation
              </li>
              <li>
                <strong>Pro plan:</strong> 1 year from creation
              </li>
              <li>
                <strong>Organization plan:</strong> Unlimited retention
              </li>
            </ul>
            <p className="mt-3">
              Your account information is retained for as long as your account
              exists. When you delete your account, we remove your personal data
              and associated meeting data in accordance with the retention
              periods above. Expired data is automatically purged through
              scheduled cleanup processes.
            </p>
          </section>

          {/* 7. Your Rights */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              7. Your Rights
            </h2>
            <p className="mt-3">
              You have the following rights regarding your personal data:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Access</strong> — You can view your account information
                and meeting data through your OSSMeet dashboard at any time.
              </li>
              <li>
                <strong>Deletion</strong> — You can delete your account from
                your account settings. This will remove your profile and
                personal data. Meeting data shared in spaces may be retained
                according to the space owner&apos;s retention policy.
              </li>
              <li>
                <strong>Export</strong> — You can download your recordings,
                transcripts, and other files directly from the meeting interface.
              </li>
              <li>
                <strong>Correction</strong> — Your display name and profile
                picture are synced from your Google account. To update them,
                update your Google profile.
              </li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights or if you have questions, contact
              us at{" "}
              <a
                href="mailto:support@ossmeet.com"
                className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
              >
                support@ossmeet.com
              </a>
              .
            </p>
          </section>

          {/* 8. Children's Privacy */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              8. Children&apos;s Privacy
            </h2>
            <p className="mt-3">
              OSSMeet is not intended for use by children under the age of 13.
              We do not knowingly collect personal information from children
              under 13. If we become aware that we have collected personal data
              from a child under 13, we will take steps to delete that
              information promptly. If you believe a child under 13 has provided
              us with personal information, please contact us at{" "}
              <a
                href="mailto:support@ossmeet.com"
                className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
              >
                support@ossmeet.com
              </a>
              .
            </p>
          </section>

          {/* 9. International Data Transfers */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              9. International Data Transfers
            </h2>
            <p className="mt-3">
              OSSMeet operates on Cloudflare&apos;s global edge network. Your
              data may be processed and stored in data centers located in
              various countries around the world. By using OSSMeet, you
              acknowledge that your information may be transferred to and
              processed in jurisdictions other than your own. We rely on
              Cloudflare&apos;s infrastructure, which maintains appropriate
              safeguards for international data transfers, including compliance
              with applicable data protection frameworks.
            </p>
          </section>

          {/* 10. Changes to This Policy */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              10. Changes to This Policy
            </h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time to reflect
              changes in our practices, technology, or legal requirements. When
              we make material changes, we will update the &quot;Last
              updated&quot; date at the top of this page. We encourage you to
              review this policy periodically. Your continued use of OSSMeet
              after any changes constitutes your acceptance of the updated
              policy.
            </p>
          </section>

          {/* 11. Contact Us */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              11. Contact Us
            </h2>
            <p className="mt-3">
              If you have any questions, concerns, or requests regarding this
              Privacy Policy or our data practices, please contact us at:
            </p>
            <p className="mt-2">
              <a
                href="mailto:support@ossmeet.com"
                className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
              >
                support@ossmeet.com
              </a>
            </p>
            <p className="mt-4 text-sm text-neutral-500">
              &copy; 2026 OSSMeet Contributors. OSSMeet is open-source software
              licensed under the MIT License.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
