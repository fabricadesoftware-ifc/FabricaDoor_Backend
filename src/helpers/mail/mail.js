const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Função para enviar o email
// function sendEmail(subject, message, fromEmail, recipientList) {
//   if (typeof recipientList === "string") {
//     recipientList = JSON.parse(recipientList);
//   }
//   const transporter = nodemailer.createTransport({
//     service: "gmail",
//     auth: {
//       user: process.env.EMAIL_HOST_USER,
//       pass: process.env.EMAIL_HOST_PASSWORD,
//     },
//   });

//   const mailOptions = {
//     from: fromEmail,
//     to: recipientList,
//     subject: subject,
//     text: message,
//   };
//   transporter.sendMail(mailOptions, function (error, info) {
//     if (error) {
//       console.log("Erro ao enviar email:", error);
//     } else {
//       console.log("Email enviado: " + info.response);
//     }
//   });
// }

async function emailForgetPassword(token, recipientList) {
  try {
    if (typeof recipientList === "string") {
      recipientList = JSON.parse(recipientList);
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_HOST_USER,
        pass: process.env.EMAIL_HOST_PASSWORD,
      },
    });

    const frontendUrl =
      process.env.FRONTEND_URL || "https://door.fabricadesoftware.ifc.edu.br";
    const resetLink = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const templatePath = path.join(__dirname, "../../templates/email.html");
    const emailTemplate = fs
      .readFileSync(templatePath, "utf-8")
      .replace("${resetLink}", resetLink)
      .replace("${token}", token);

    const mailOptions = {
      from: process.env.EMAIL_HOST_USER,
      to: recipientList,
      subject: "Redefinição de Senha - Door Auth",
      html: emailTemplate,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log("Email enviado: " + info.response);
    return { success: true, response: info.response };
  } catch (error) {
    console.log("Erro ao enviar email:", error);
    return { success: false, error: error.message };
  }
}

module.exports = { emailForgetPassword };
