const ERRORS = {
//400
  badReq: {
    error: {
      code: "bad_req",
      message: "Invalid Request",
    },
  },
//404
  notFound: {
    error: {
      code: "not_found",
      message: "Id not found",
    },
  },
//413
  bodyTooLarge: {
    error: {
      code: "body_too_large",
      message: "Request exceeded size limit",
    },
  },
//415
  badChar: {
    error: {
      code: "bad_char",
      message: "Unsupported charset or encoding",
    },
  },
//429
  rateLimited: {
    error: {
      code: "rate_limited",
      message: "Too many requests",
    },
  },
//500
  internalError: {
    error: {
      code: "internal_error",
      message: "Something went wrong",
    },
  },
} as const;

export { ERRORS };
