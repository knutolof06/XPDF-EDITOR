using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading.Tasks;
using Windows.Data.Pdf;
using Windows.Storage;
using Windows.Storage.Streams;

class Program
{
    static void Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || string.IsNullOrWhiteSpace(args[0]))
            {
                Console.WriteLine("Usage: test_pdf.exe <path-to-pdf> [output-png-path]");
                return;
            }

            string pdfPath = Path.GetFullPath(args[0]);
            if (!File.Exists(pdfPath))
            {
                Console.Error.WriteLine("PDF file not found: " + pdfPath);
                return;
            }

            string outputPath = args.Length > 1 && !string.IsNullOrWhiteSpace(args[1])
                ? Path.GetFullPath(args[1])
                : Path.Combine(Path.GetTempPath(), "xpdf_test_thumb.png");

            Console.WriteLine("PDF: " + pdfPath);
            RenderPdfFirstPage(pdfPath, outputPath).Wait();
            Console.WriteLine("Success: thumbnail generated at " + outputPath);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error: " + ex);
        }
    }

    static async Task RenderPdfFirstPage(string pdfPath, string outputPath)
    {
        StorageFile file = await StorageFile.GetFileFromPathAsync(pdfPath);
        PdfDocument doc = await PdfDocument.LoadFromFileAsync(file);
        if (doc.PageCount == 0) return;

        using (PdfPage page = doc.GetPage(0))
        {
            var stream = new InMemoryRandomAccessStream();
            var options = new PdfPageRenderOptions();
            options.DestinationWidth = 512;
            options.DestinationHeight = (uint)(512 * (page.Size.Height / page.Size.Width));
            await page.RenderToStreamAsync(stream, options);

            using (Stream netStream = stream.AsStream())
            using (Image img = Image.FromStream(netStream))
            {
                img.Save(outputPath, ImageFormat.Png);
            }
        }
    }
}
