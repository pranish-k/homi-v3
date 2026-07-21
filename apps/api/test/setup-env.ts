// The suite signs in through the real magic-link flow and captures the
// URL from the dev seam; a RESEND_API_KEY inherited from the developer's
// shell would turn every signIn into real outbound mail (HOMI-21).
delete process.env.RESEND_API_KEY;
